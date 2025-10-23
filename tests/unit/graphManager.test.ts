import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GraphManager } from '../../src/graph/GraphManager.js';
import { InMemoryGraphStore } from '../../src/graph/store/InMemoryGraphStore.js';
import { CodeGraph } from '../../src/graph/CodeGraph.js';
import { DiffOverlay } from '../../src/graph/DiffOverlay.js';

function createGraphWithFile(path: string): CodeGraph {
  const graph = new CodeGraph();
  graph.addNode({
    type: 'file',
    name: path.split('/').pop() ?? path,
    path,
    content: '',
    startLine: 1,
    endLine: 1,
    metadata: {},
  });
  return graph;
}

describe('GraphManager', () => {
  const store = new InMemoryGraphStore();
  const rootDir = '/tmp/project';
  let firstGraph: CodeGraph;
  let secondGraph: CodeGraph;
  let builderMock: { build: ReturnType<typeof vi.fn<[], Promise<CodeGraph>>> };
  let manager: GraphManager;

  beforeEach(() => {
    firstGraph = createGraphWithFile('src/first.ts');
    secondGraph = createGraphWithFile('src/second.ts');

    const build = vi.fn<[], Promise<CodeGraph>>()
      .mockResolvedValueOnce(firstGraph)
      .mockResolvedValue(secondGraph);
    builderMock = { build };

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

    // Second initialise uses cached graph, builder not called again
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

  it('applies overlays and persists the result', async () => {
    await manager.initialize(true);

    const overlay = new DiffOverlay('test', '{}');
    overlay.addOperation({
      type: 'add',
      node: {
        id: 'new-node',
        type: 'file',
        name: 'new.ts',
        path: 'src/new.ts',
        content: '',
        startLine: 1,
        endLine: 1,
        metadata: {},
      },
    });

    const updated = await manager.applyOverlay(overlay);
    expect(updated.getNodesByPath('src/new.ts')).toHaveLength(1);

    // Ensure store persisted update
    const freshManager = new GraphManager({
      rootDir,
      store,
      builder: builderMock,
    });
    const { graph } = await freshManager.initialize();
    expect(graph.getNodesByPath('src/new.ts')).toHaveLength(1);
  });

  it('clears store and local cache', async () => {
    await manager.initialize();
    await manager.clearStore();
    await expect(manager.initialize()).resolves.toBeDefined();
  });
});
