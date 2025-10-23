import type { GraphStore, GraphStoreConfig } from './GraphStore.js';
import { InMemoryGraphStore } from './InMemoryGraphStore.js';
import { Neo4jGraphStore } from './Neo4jGraphStore.js';

export async function createGraphStore(
  config: GraphStoreConfig | undefined
): Promise<GraphStore> {
  const kind = config?.kind ?? 'memory';

  switch (kind) {
    case 'memory':
      return new InMemoryGraphStore();
    case 'neo4j':
      return new Neo4jGraphStore(config ?? { kind: 'neo4j' });
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported graph store kind: ${exhaustive}`);
    }
  }
}

export type { GraphStore, GraphStoreConfig } from './GraphStore.js';
