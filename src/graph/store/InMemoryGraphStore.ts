import { CodeGraph } from '../CodeGraph.js';
import type { GraphStore } from './GraphStore.js';

export class InMemoryGraphStore implements GraphStore {
  private graph: CodeGraph | null = null;

  async load(): Promise<CodeGraph | null> {
    if (!this.graph) {
      return null;
    }
    return this.graph.clone();
  }

  async save(graph: CodeGraph): Promise<void> {
    this.graph = graph.clone();
  }

  async clear(): Promise<void> {
    this.graph = null;
  }
}
