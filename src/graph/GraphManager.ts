import { CodeGraph } from './CodeGraph.js';
import { GraphBuilder } from './GraphBuilder.js';
import { DiffOverlay } from './DiffOverlay.js';
import type { GraphStore } from './store/GraphStore.js';

interface GraphBuilderLike {
  build(): Promise<CodeGraph>;
}

export interface GraphManagerOptions {
  rootDir: string;
  store: GraphStore;
  builder?: GraphBuilderLike;
}

export type GraphSource = 'store' | 'build';

export interface InitializeResult {
  graph: CodeGraph;
  source: GraphSource;
}

export class GraphManager {
  private graph: CodeGraph | null = null;
  private readonly builder: GraphBuilderLike;

  constructor(private readonly options: GraphManagerOptions) {
    this.builder = options.builder ?? new GraphBuilder(options.rootDir);
  }

  async initialize(forceRebuild = false): Promise<InitializeResult> {
    if (!forceRebuild) {
      const stored = await this.options.store.load();
      if (stored) {
        this.graph = stored;
        return { graph: this.graph, source: 'store' };
      }
    }

    const built = await this.builder.build();
    await this.options.store.save(built);
    this.graph = built;
    return { graph: built, source: 'build' };
  }

  getGraph(): CodeGraph {
    if (!this.graph) {
      throw new Error('GraphManager has not been initialized.');
    }
    return this.graph;
  }

  async rebuild(): Promise<CodeGraph> {
    const built = await this.builder.build();
    await this.options.store.save(built);
    this.graph = built;
    return built;
  }

  async applyOverlay(overlay: DiffOverlay): Promise<CodeGraph> {
    if (!this.graph) {
      throw new Error('GraphManager has not been initialized.');
    }
    const updated = overlay.apply(this.graph);
    await this.options.store.save(updated);
    this.graph = updated;
    return updated;
  }

  async clearStore(): Promise<void> {
    await this.options.store.clear();
    this.graph = null;
  }
}
