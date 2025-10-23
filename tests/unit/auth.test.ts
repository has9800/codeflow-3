import { describe, it, beforeEach, expect, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { ApiKeyStore } from '../../src/auth/ApiKeyStore.js';
import { loadConfig } from '../../src/config/settings.js';

const homeDir = process.env.CODEFLOW_HOME ?? os.homedir();
const SECURE_FILE = path.join(homeDir, '.codeflow', 'secure.json');

describe('ApiKeyStore', () => {
  let store: ApiKeyStore;

  beforeEach(async () => {
    store = new ApiKeyStore();
    await store.clear();
  });

  afterEach(async () => {
    await store.clear();
  });

  it('encrypts API keys at rest', async () => {
    const secret = 'test-secret-123';
    await store.set(secret);

    const config = await loadConfig();
    expect(config.apiKey).toBeUndefined();
    expect(config.encryptedApiKey).toBeDefined();
    expect(config.encryptedApiKey).not.toContain(secret);

    const restored = await store.get();
    expect(restored).toBe(secret);
  });

  it('removes stored keys on clear', async () => {
    await store.set('to-be-cleared');
    await store.clear();

    const config = await loadConfig();
    expect(config.encryptedApiKey).toBeUndefined();

    await expect(fs.access(SECURE_FILE)).rejects.toBeDefined();
  });

  it('persists account metadata alongside encrypted key', async () => {
    await store.set('another-secret', { accountLabel: 'dev@example.com' });

    const metadata = await store.getMetadata();
    expect(metadata.accountLabel).toBe('dev@example.com');

    const config = await loadConfig();
    expect(config.accountLabel).toBe('dev@example.com');
  });
});
