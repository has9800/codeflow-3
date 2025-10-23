import { ApiKeyStore } from './ApiKeyStore.js';
import { DeviceCodeFlow } from './DeviceCodeFlow.js';

export interface AuthManagerOptions {
  deviceFlow?: DeviceCodeFlow;
  store?: ApiKeyStore;
}

export interface AuthSession {
  apiKey: string;
  accountLabel?: string;
}

export class AuthManager {
  private readonly store: ApiKeyStore;
  private readonly deviceFlow: DeviceCodeFlow;

  constructor(options: AuthManagerOptions = {}) {
    this.store = options.store ?? new ApiKeyStore();
    this.deviceFlow = options.deviceFlow ?? new DeviceCodeFlow();
  }

  async getSession(): Promise<AuthSession | null> {
    const apiKey = await this.store.get();
    if (!apiKey) {
      return null;
    }
    const metadata = await this.store.getMetadata();
    return { apiKey, accountLabel: metadata.accountLabel };
  }

  async ensureAuthenticated(): Promise<AuthSession> {
    const existing = await this.getSession();
    if (existing) {
      return existing;
    }

    const result = await this.deviceFlow.authenticate();
    if (result.cancelled || !result.apiKey) {
      throw new Error(
        'Authentication cancelled. Run `codeflow login` to supply an API key manually.'
      );
    }

    await this.store.set(result.apiKey, { accountLabel: result.accountLabel });
    return {
      apiKey: result.apiKey,
      accountLabel: result.accountLabel,
    };
  }

  async manualLogin(): Promise<AuthSession> {
    const manualFlow = new DeviceCodeFlow({ manualOnly: true });
    const result = await manualFlow.authenticate();
    if (!result.apiKey) {
      throw new Error('API key is required to complete login.');
    }
    await this.store.set(result.apiKey, { accountLabel: result.accountLabel });
    return {
      apiKey: result.apiKey,
      accountLabel: result.accountLabel,
    };
  }

  async logout(): Promise<void> {
    await this.store.clear();
  }
}
