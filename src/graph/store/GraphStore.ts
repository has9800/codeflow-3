import { CodeGraph } from '../CodeGraph.js';

export interface GraphStore {
  load(): Promise<CodeGraph | null>;
  save(graph: CodeGraph): Promise<void>;
  clear(): Promise<void>;
}

export type GraphStoreKind = 'memory' | 'neo4j';

export interface GraphStoreConfig {
  kind: GraphStoreKind;
  uri?: string;
  username?: string;
  password?: string;
  namespace?: string;
  maxConnectionPoolSize?: number;
  connectionTimeoutMs?: number;
  provisioning?: {
    enabled?: boolean;
    apiUrl?: string;
    apiKey?: string;
    retentionDays?: number;
    databaseId?: string;
    expiresAt?: string;
  };
}
