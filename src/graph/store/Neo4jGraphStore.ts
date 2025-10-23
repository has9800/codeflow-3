import { CodeGraph } from '../CodeGraph.js';
import type { GraphStore, GraphStoreConfig } from './GraphStore.js';

export class Neo4jGraphStore implements GraphStore {
  constructor(private readonly config: GraphStoreConfig) {}

  async load(): Promise<CodeGraph | null> {
    throw new Error(
      'Neo4j graph store is not implemented yet. Install neo4j-driver and update GraphManager once the adapter is complete.'
    );
  }

  async save(_graph: CodeGraph): Promise<void> {
    throw new Error(
      'Neo4j graph store is not implemented yet. Install neo4j-driver and update GraphManager once the adapter is complete.'
    );
  }

  async clear(): Promise<void> {
    return;
  }
}
