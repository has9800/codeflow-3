import { logger } from '../../utils/logger.js';
import type { GraphStoreConfig } from './GraphStore.js';

interface ProvisionResponse {
  id: string;
  uri: string;
  username: string;
  password: string;
  expires_at?: string;
}

export class Neo4jProvisioner {
  constructor(private readonly config: GraphStoreConfig) {}

  async ensure(): Promise<{ uri: string; username: string; password: string; id: string; expiresAt?: string }> {
    const provisioning = this.requireProvisioning();

    const { databaseId, expiresAt } = provisioning;
    if (databaseId && expiresAt && Date.parse(expiresAt) > Date.now() && this.config.uri && this.config.username && this.config.password) {
      return {
        uri: this.config.uri,
        username: this.config.username,
        password: this.config.password,
        id: databaseId,
        expiresAt,
      };
    }

    const retention = Math.min(Math.max(provisioning.retentionDays ?? 1, 1), 90);
    const response = await this.request<ProvisionResponse>(`${provisioning.apiUrl}/databases`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ retention_days: retention }),
    });

    if (!response || !response.id || !response.uri) {
      throw new Error('Provisioning API returned an invalid response.');
    }

    return {
      uri: response.uri,
      username: response.username,
      password: response.password,
      id: response.id,
      expiresAt: response.expires_at,
    };
  }

  async destroy(): Promise<void> {
    const provisioning = this.requireProvisioning();
    if (!provisioning.databaseId) {
      return;
    }

    try {
      await this.request<void>(`${provisioning.apiUrl}/databases/${provisioning.databaseId}`, {
        method: 'DELETE',
        headers: this.headers(),
      });
    } catch (error) {
      logger.warn('Failed to destroy Neo4j provisioned database', error);
    }
  }

  private requireProvisioning() {
    const provisioning = this.config.provisioning;
    if (!provisioning?.enabled) {
      throw new Error('Neo4j provisioning requested but not enabled in config.');
    }
    if (!provisioning.apiUrl) {
      throw new Error('Neo4j provisioning API URL is required when provisioning is enabled.');
    }
    return provisioning;
  }

  private headers(): Record<string, string> {
    const provisioning = this.requireProvisioning();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provisioning.apiKey) {
      headers['Authorization'] = `Bearer ${provisioning.apiKey}`;
    }
    return headers;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`Provisioning request failed (${response.status})`);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }
}
