import { nanoid } from 'nanoid';
import { CodeGraph, type GraphEdge } from './CodeGraph.js';
import { GraphBuilder } from './GraphBuilder.js';
import { DiffOverlay } from './DiffOverlay.js';
import type { GraphStore } from './store/GraphStore.js';
import type { FileGraphSnapshot } from './types.js';
import { logger } from '../utils/logger.js';

interface GraphBuilderLike {
  build(): Promise<CodeGraph>;
  buildFileSnapshot(filePath: string): Promise<FileGraphSnapshot | null>;
  resolveEdges(
    graph: CodeGraph,
    edges: GraphEdge[],
    exportedIndex: Map<string, string>
  ): GraphEdge[];
}

export interface GraphManagerOptions {
  rootDir: string;
  store: GraphStore;
  builder?: GraphBuilderLike;
  hooks?: GraphOverlayHooks;
}

export type GraphSource = 'store' | 'build';

export interface InitializeResult {
  graph: CodeGraph;
  source: GraphSource;
}

export interface GraphOverlayCommitPayload {
  overlayId: string;
  serializedOverlay: string;
  mergedGraph: CodeGraph;
}

export interface GraphOverlayHooks {
  onOverlayCreated?(overlay: DiffOverlay): void;
  onOverlayUpdated?(overlay: DiffOverlay): void;
  onOverlayCommitted?(payload: GraphOverlayCommitPayload): void;
  onOverlayDiscarded?(overlayId: string): void;
}

export class GraphManager {
  private readonly builder: GraphBuilderLike;
  private baseGraph: CodeGraph | null = null;
  private overlay: DiffOverlay | null = null;
  private overlayCache: CodeGraph | null = null;
  private overlayCacheDirty = false;
  private readonly overlayModifiedPaths = new Set<string>();
  private readonly hooks?: GraphOverlayHooks;

  constructor(private readonly options: GraphManagerOptions) {
    this.builder = options.builder ?? new GraphBuilder(options.rootDir);
    this.hooks = options.hooks;
  }

  async initialize(forceRebuild = false): Promise<InitializeResult> {
    if (!forceRebuild) {
      const stored = await this.options.store.load();
      if (stored) {
        this.baseGraph = stored;
        this.resetOverlayState();
        return { graph: stored, source: 'store' };
      }
    }

    const built = await this.builder.build();
    await this.options.store.save(built);
    this.baseGraph = built;
    this.resetOverlayState();
    return { graph: built, source: 'build' };
  }

  getGraph(): CodeGraph {
    if (!this.baseGraph) {
      throw new Error('GraphManager has not been initialized.');
    }

    if (!this.overlay || this.overlay.isEmpty()) {
      return this.baseGraph;
    }

    if (!this.overlayCacheDirty && this.overlayCache) {
      return this.overlayCache;
    }

    const merged = this.overlay.apply(this.baseGraph);
    this.overlayCache = merged;
    this.overlayCacheDirty = false;
    return merged;
  }

  getBaseGraph(): CodeGraph {
    if (!this.baseGraph) {
      throw new Error('GraphManager has not been initialized.');
    }
    return this.baseGraph;
  }

  async rebuild(): Promise<CodeGraph> {
    const rebuilt = await this.builder.build();
    await this.options.store.save(rebuilt);
    this.baseGraph = rebuilt;
    this.resetOverlayState();
    return rebuilt;
  }

  hasPendingOverlay(): boolean {
    return Boolean(this.overlay && !this.overlay.isEmpty());
  }

  getPendingOverlay(): DiffOverlay | null {
    return this.overlay;
  }

  async recordFileModification(filePath: string): Promise<CodeGraph> {
    if (!this.baseGraph) {
      throw new Error('GraphManager has not been initialized.');
    }

    const snapshot = await this.builder.buildFileSnapshot(filePath);
    const overlay = this.ensureOverlay();
    overlay.clearPath(filePath);
    this.overlayModifiedPaths.add(filePath);

    const baseNodes = this.baseGraph.getNodesByPath(filePath);
    for (const node of baseNodes) {
      overlay.addOperation({
        type: 'remove',
        nodeId: node.id,
        metadata: { path: filePath },
      });
    }

    if (snapshot) {
      const workingGraph = this.baseGraph.clone();
      workingGraph.removeNodesByPath(filePath);
      workingGraph.upsertNode(snapshot.file);
      for (const node of snapshot.symbols) {
        workingGraph.upsertNode(node);
      }

      const exportedIndex = GraphBuilder.buildExportedIndexFromGraph(workingGraph);
      const resolvedEdges = this.builder.resolveEdges(
        workingGraph,
        snapshot.edges,
        exportedIndex
      );

      overlay.addOperation({
        type: 'add',
        node: snapshot.file,
      });
      for (const node of snapshot.symbols) {
        overlay.addOperation({
          type: 'add',
          node,
        });
      }
      for (const edge of resolvedEdges) {
        overlay.addOperation({
          type: 'add',
          edge,
          metadata: { path: filePath },
        });
      }
    }

    this.overlayCacheDirty = true;
    this.overlayCache = null;
    this.hooks?.onOverlayUpdated?.(overlay);
    return this.getGraph();
  }

  async mergeOverlay(): Promise<CodeGraph> {
    if (!this.baseGraph) {
      throw new Error('GraphManager has not been initialized.');
    }

    if (!this.overlay || this.overlay.isEmpty()) {
      return this.baseGraph;
    }

    logger.debug('Merging overlay into base graph', {
      overlayId: this.overlay.id,
      modifiedPaths: Array.from(this.overlayModifiedPaths),
    });

    const overlaySnapshot = this.overlay.toJSON();
    const overlayId = this.overlay.id;

    const rebuilt = await this.builder.build();
    await this.options.store.save(rebuilt);
    this.baseGraph = rebuilt;
    this.hooks?.onOverlayCommitted?.({
      overlayId,
      serializedOverlay: overlaySnapshot,
      mergedGraph: rebuilt,
    });
    this.resetOverlayState();
    return rebuilt;
  }

  async discardOverlay(): Promise<CodeGraph> {
    if (this.overlay) {
      this.hooks?.onOverlayDiscarded?.(this.overlay.id);
    }
    this.resetOverlayState();
    if (!this.baseGraph) {
      throw new Error('GraphManager has not been initialized.');
    }
    return this.baseGraph;
  }

  async clearStore(): Promise<void> {
    await this.options.store.clear();
    this.baseGraph = null;
    if (this.overlay) {
      this.hooks?.onOverlayDiscarded?.(this.overlay.id);
    }
    this.resetOverlayState();
  }

  private ensureOverlay(): DiffOverlay {
    if (!this.baseGraph) {
      throw new Error('GraphManager has not been initialized.');
    }
    if (!this.overlay) {
      this.overlay = new DiffOverlay(nanoid(), this.baseGraph.toJSON());
      this.hooks?.onOverlayCreated?.(this.overlay);
    }
    return this.overlay;
  }

  private resetOverlayState(): void {
    this.overlay = null;
    this.overlayCache = this.baseGraph;
    this.overlayCacheDirty = false;
    this.overlayModifiedPaths.clear();
  }
}
