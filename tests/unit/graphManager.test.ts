import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphManager } from '../../src/graph/GraphManager.js';
import { InMemoryGraphStore } from '../../src/graph/store/InMemoryGraphStore.js';
import { CodeGraph, type GraphEdge, type GraphNode } from '../../src/graph/CodeGraph.js';
import type { FileGraphSnapshot } from '../../src/graph/types.js';

function createGraphWithFile(path: string): CodeGraph {
  const graph = new CodeGraph();
  graph.upsertNode({
    id: `file:${path}`,
    type: 'file',
    name: path.split('/').pop() ?? path,
    path,
    content: '',
    startLine: 1,
    endLine: 1,
    metadata: { language: 'typescript', digest: 'base-digest' },
  });
  return graph;
}

function createSnapshot(filePath: string): FileGraphSnapshot {
  const fileNode: GraphNode = {
    id: 'file-new',
    type: 'file',
    name: filePath.split('/').pop() ?? filePath,
    path: filePath,
    content: '',
    startLine: 1,
    endLine: 5,
    metadata: { language: 'typescript', digest: 'snapshot-digest' },
  };

  const symbolNode: GraphNode = {
    id: 'symbol-new',
    type: 'function',
    name: 'foo',
    path: filePath,
    content: 'export function foo() {}',
    startLine: 1,
    endLine: 3,
    metadata: { exported: true, kind: 'function' },
  };

  const containsEdge: GraphEdge = {
    id: 'edge-contains',
    from: fileNode.id,
    to: symbolNode.id,
    type: 'contains',
    metadata: {},
  };

  return {
    filePath,
    language: 'typescript',
    file: fileNode,
    symbols: [symbolNode],
    edges: [containsEdge],
    digest: 'snapshot-digest',
  };
}

describe('GraphManager', () => {
  let store: InMemoryGraphStore;
  const rootDir = '/tmp/project';
  let firstGraph: CodeGraph;
  let secondGraph: CodeGraph;
  let builderMock: {
    build: ReturnType<typeof vi.fn<[], Promise<CodeGraph>>>;
    buildFileSnapshot: ReturnType<typeof vi.fn<[string], Promise<FileGraphSnapshot | null>>>;
    resolveEdges: ReturnType<
      typeof vi.fn<[CodeGraph, GraphEdge[], Map<string, string>], GraphEdge[]>
    >;
  };
  let manager: GraphManager;

  beforeEach(() => {
    store = new InMemoryGraphStore();
    firstGraph = createGraphWithFile('src/first.ts');
    secondGraph = createGraphWithFile('src/second.ts');

    builderMock = {
      build: vi
        .fn<[], Promise<CodeGraph>>()
        .mockResolvedValueOnce(firstGraph)
        .mockResolvedValue(secondGraph),
      buildFileSnapshot: vi
        .fn<[string], Promise<FileGraphSnapshot | null>>()
        .mockResolvedValue(null),
      resolveEdges: vi
        .fn<[CodeGraph, GraphEdge[], Map<string, string>], GraphEdge[]>()
        .mockImplementation((_graph: CodeGraph, edges: GraphEdge[]) => edges),
    };

    manager = new GraphManager({
      rootDir,
      store,
      builder: builderMock,
    });
  });

  it('initialises from builder and caches graph in store', async () => {
    const { graph, source } = await manager.initialize();

    expect(source).toBe('build');
    expect(builderMock.build).toHaveBeenCalledTimes(1);
    expect(graph.getAllNodes()).toHaveLength(1);

    const cached = await manager.initialize();
    expect(cached.source).toBe('store');
    expect(builderMock.build).toHaveBeenCalledTimes(1);
    expect(cached.graph.getAllNodes()).toHaveLength(1);
  });

  it('forces rebuild when requested', async () => {
    await manager.initialize();
    const rebuilt = await manager.initialize(true);

    expect(builderMock.build).toHaveBeenCalledTimes(2);
    expect(rebuilt.source).toBe('build');
    expect(rebuilt.graph.getAllNodes()[0]?.path).toBe('src/second.ts');
  });

  it('records file modifications and updates overlay graph', async () => {
    await manager.initialize(true);

    const snapshot = createSnapshot('src/first.ts');
    builderMock.buildFileSnapshot.mockResolvedValueOnce(snapshot);
    builderMock.resolveEdges.mockImplementation((_graph: CodeGraph, edges: GraphEdge[]) => edges);

    const updatedGraph = await manager.recordFileModification('src/first.ts');

    expect(builderMock.buildFileSnapshot).toHaveBeenCalledWith('src/first.ts');
    expect(builderMock.resolveEdges).toHaveBeenCalled();
    const nodes = updatedGraph.getNodesByPath('src/first.ts');
    expect(nodes.some(node => node.id === 'file-new')).toBe(true);
    expect(manager.hasPendingOverlay()).toBe(true);
  });

  it('mergeOverlay rebuilds graph and clears overlay', async () => {
    await manager.initialize(true);

    const snapshot = createSnapshot('src/first.ts');
    builderMock.buildFileSnapshot.mockResolvedValue(snapshot);
    builderMock.resolveEdges.mockImplementation((_graph: CodeGraph, edges: GraphEdge[]) => edges);

    await manager.recordFileModification('src/first.ts');
    expect(manager.hasPendingOverlay()).toBe(true);

    const rebuiltGraph = createGraphWithFile('src/final.ts');
    builderMock.build.mockResolvedValueOnce(rebuiltGraph);

    const merged = await manager.mergeOverlay();

    expect(builderMock.build).toHaveBeenCalledTimes(2);
    expect(manager.hasPendingOverlay()).toBe(false);
    expect(merged.getNodesByPath('src/final.ts')).toHaveLength(1);
  });

  it('clears store and local cache', async () => {
    await manager.initialize();
    await manager.clearStore();
    await expect(manager.initialize()).resolves.toBeDefined();
  });

  it('emits overlay lifecycle hooks', async () => {
    const createdIds: string[] = [];
    const updatedIds: string[] = [];
    const committedIds: string[] = [];
    const discardedIds: string[] = [];

    const hooks = {
      onOverlayCreated: vi.fn(overlay => createdIds.push(overlay.id)),
      onOverlayUpdated: vi.fn(overlay => updatedIds.push(overlay.id)),
      onOverlayCommitted: vi.fn(payload => committedIds.push(payload.overlayId)),
      onOverlayDiscarded: vi.fn(overlayId => discardedIds.push(overlayId)),
    };

    manager = new GraphManager({
      rootDir,
      store,
      builder: builderMock,
      hooks,
    });

    await manager.initialize(true);

    const snapshot = createSnapshot('src/first.ts');
    builderMock.buildFileSnapshot.mockResolvedValue(snapshot);
    builderMock.resolveEdges.mockImplementation((_graph: CodeGraph, edges: GraphEdge[]) => edges);

    await manager.recordFileModification('src/first.ts');
    expect(hooks.onOverlayCreated).toHaveBeenCalledTimes(1);
    expect(hooks.onOverlayUpdated).toHaveBeenCalledTimes(1);
    expect(createdIds[0]).toBeDefined();

    await manager.discardOverlay();
    expect(hooks.onOverlayDiscarded).toHaveBeenCalledWith(createdIds[0]);

    await manager.recordFileModification('src/first.ts');
    expect(hooks.onOverlayCreated).toHaveBeenCalledTimes(2);
    expect(hooks.onOverlayUpdated).toHaveBeenCalledTimes(2);
    const secondOverlayId = createdIds[1];

    await manager.mergeOverlay();
    expect(hooks.onOverlayCommitted).toHaveBeenCalledTimes(1);
    expect(committedIds[0]).toBe(secondOverlayId);
    expect(updatedIds).toContain(secondOverlayId);
    expect(discardedIds[0]).toBe(createdIds[0]);
  });
});
