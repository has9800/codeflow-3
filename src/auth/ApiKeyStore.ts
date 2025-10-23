import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import crypto from 'crypto';
import { loadConfig, initConfig } from '../config/settings.js';

function resolveHomeDir(): string {
  return process.env.CODEFLOW_HOME || os.homedir();
}

function secureDir(): string {
  return path.join(resolveHomeDir(), '.codeflow');
}

function secureKeyPath(): string {
  return path.join(secureDir(), 'secure.json');
}

export interface ApiKeyMetadata {
  accountLabel?: string;
}

/**
 * Handles secure persistence of API keys.
 * Prefers AES-256-GCM encrypted storage keyed by a machine-local secret.
 */
export class ApiKeyStore {
  private masterKeyPromise: Promise<Buffer> | null = null;

  async get(): Promise<string | undefined> {
    const config = await loadConfig();

    if (config.apiKey) {
      // Migrate legacy plain-text key into secure storage.
      await this.set(config.apiKey);
      return config.apiKey;
    }

    if (!config.encryptedApiKey) {
      return undefined;
    }

    const masterKey = await this.getOrCreateMasterKey();
    return this.decrypt(config.encryptedApiKey, masterKey);
  }

  async set(apiKey: string, metadata: ApiKeyMetadata = {}): Promise<void> {
    const masterKey = await this.getOrCreateMasterKey();
    const encrypted = this.encrypt(apiKey, masterKey);

    await initConfig({
      apiKey: undefined,
      encryptedApiKey: encrypted,
      accountLabel: metadata.accountLabel,
    });
  }

  async clear(): Promise<void> {
    await initConfig({
      apiKey: undefined,
      encryptedApiKey: undefined,
      accountLabel: undefined,
    });

    await this.deleteMasterKey();
  }

  async getMetadata(): Promise<ApiKeyMetadata> {
    const config = await loadConfig();
    return {
      accountLabel: config.accountLabel,
    };
  }

  private async getOrCreateMasterKey(): Promise<Buffer> {
    if (!this.masterKeyPromise) {
      this.masterKeyPromise = this.loadOrCreateMasterKey();
    }
    return this.masterKeyPromise;
  }

  private async loadOrCreateMasterKey(): Promise<Buffer> {
    const keyFile = secureKeyPath();
    try {
      const raw = await fs.readFile(keyFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed?.masterKey) {
        return Buffer.from(parsed.masterKey, 'base64');
      }
    } catch {
      // Fall through to key creation.
    }

    const masterKey = crypto.randomBytes(32);
    await fs.mkdir(secureDir(), { recursive: true, mode: 0o700 }).catch(() => {});

    const payload = JSON.stringify({ masterKey: masterKey.toString('base64') });
    await fs.writeFile(keyFile, payload, { mode: 0o600 });
    await this.hardenPermissions(keyFile, 0o600);

    return masterKey;
  }

  private async deleteMasterKey(): Promise<void> {
    try {
      await fs.unlink(secureKeyPath());
    } catch {
      // Ignore missing files.
    }
    this.masterKeyPromise = null;
  }

  private encrypt(value: string, key: Buffer): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  private decrypt(payload: string, key: Buffer): string | undefined {
    try {
      const buffer = Buffer.from(payload, 'base64');
      const iv = buffer.subarray(0, 12);
      const authTag = buffer.subarray(12, 28);
      const ciphertext = buffer.subarray(28);

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString('utf8');
    } catch {
      return undefined;
    }
  }

  private async hardenPermissions(target: string, mode: number): Promise<void> {
    try {
      await fs.chmod(target, mode);
    } catch {
      // Best effort; some filesystems may not support chmod.
    }
  }
}
