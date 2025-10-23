import { nanoid } from 'nanoid';
import { CodeGraph } from './CodeGraph.js';
import { GraphBuilder } from './GraphBuilder.js';
import { DiffOverlay } from './DiffOverlay.js';
import type { GraphStore } from './store/GraphStore.js';
import { logger } from '../utils/logger.js';

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
  private activeOverlay: DiffOverlay | null = null;
  private overlayModifiedPaths: Set<string> = new Set();

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

  recordFileModification(path: string): DiffOverlay {
    if (!this.graph) {
      throw new Error('GraphManager has not been initialized.');
    }

    const overlay = this.ensureOverlay();
    overlay.addOperation({
      type: 'modify',
      metadata: { path },
    });

    this.overlayModifiedPaths.add(path);
    return overlay;
  }

  hasPendingOverlay(): boolean {
    return Boolean(this.activeOverlay && !this.activeOverlay.isEmpty());
  }

  getPendingOverlay(): DiffOverlay | null {
    return this.activeOverlay;
  }

  async mergeOverlay(): Promise<CodeGraph> {
    if (!this.activeOverlay) {
      return this.getGraph();
    }

    if (!this.graph) {
      throw new Error('GraphManager has not been initialized.');
    }

    const overlay = this.activeOverlay;
    const modifiedPaths = Array.from(this.overlayModifiedPaths.values());

    const stored = await this.options.store.load();
    const currentStoreSnapshot = stored ? stored.toJSON() : null;
    const baseSnapshot = overlay.baseGraphSnapshot;

    if (currentStoreSnapshot && baseSnapshot && currentStoreSnapshot !== baseSnapshot) {
      logger.warn('Graph snapshot changed since overlay creation. Rebuilding graph before merge.', {
        modifiedPaths,
      });
      this.graph = stored;
    }

    const rebuilt = await this.builder.build();
    await this.options.store.save(rebuilt);
    this.graph = rebuilt;

    this.activeOverlay = null;
    this.overlayModifiedPaths.clear();
    return rebuilt;
  }

  private ensureOverlay(): DiffOverlay {
    if (!this.graph) {
      throw new Error('GraphManager has not been initialized.');
    }

    if (!this.activeOverlay) {
      this.activeOverlay = new DiffOverlay(nanoid(), this.graph.toJSON());
    }

    return this.activeOverlay;
  }
}
