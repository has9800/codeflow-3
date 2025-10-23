import Conf from 'conf';
import { SUPPORTED_MODELS } from './models.js';
import type { GraphStoreConfig } from '../graph/store/GraphStore.js';

interface Config {
  apiKey?: string;
  encryptedApiKey?: string;
  accountLabel?: string;
  defaultModel: string;
  autoTest: boolean;
  reviewMode: 'all' | 'each' | 'auto';
  graphStore: GraphStoreConfig;
}

const config = new Conf<Config>({
  projectName: 'codeflow',
  defaults: {
    defaultModel: 'anthropic/claude-sonnet-4.5',
    autoTest: false,
    reviewMode: 'each',
    graphStore: {
      kind: 'memory',
    },
  },
});

export async function loadConfig(): Promise<Config> {
  const storedGraphStore = config.get('graphStore');
  return {
    apiKey: config.get('apiKey'),
    encryptedApiKey: config.get('encryptedApiKey'),
    accountLabel: config.get('accountLabel'),
    defaultModel: config.get('defaultModel'),
    autoTest: config.get('autoTest'),
    reviewMode: config.get('reviewMode'),
    graphStore: storedGraphStore ?? { kind: 'memory' },
  };
}

export async function initConfig(updates?: Partial<Config>): Promise<void> {
  if (updates) {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        const store = config as unknown as { delete?: (key: keyof Config) => void };
        if (typeof store.delete === 'function') {
          store.delete(key as keyof Config);
        } else {
          config.set(key as keyof Config, value as Config[keyof Config]);
        }
      } else {
        config.set(key as keyof Config, value as Config[keyof Config]);
      }
    }
  }
}

export async function getApiKey(): Promise<string | undefined> {
  return config.get('apiKey');
}

export async function setApiKey(apiKey: string): Promise<void> {
  config.set('apiKey', apiKey);
}
