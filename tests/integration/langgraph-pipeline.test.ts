import { describe, it, expect, beforeAll } from 'vitest';
import { CodeGraph } from '../../src/graph/CodeGraph.js';
import type { GraphManagerLike, RetrievalComponentFactory } from '../../src/orchestration/LangGraphPipeline.js';
import { LangGraphPipeline } from '../../src/orchestration/LangGraphPipeline.js';
import { EvaluationAgent } from '../../src/orchestration/EvaluationAgent.js';
import type { InitializeResult } from '../../src/graph/GraphManager.js';
import { InMemoryGraphStore } from '../../src/graph/store/InMemoryGraphStore.js';
import { GraphManager } from '../../src/graph/GraphManager.js';
import type { GraphEdge, GraphNode } from '../../src/graph/CodeGraph.js';
import type { RetrievalComponents } from '../../src/orchestration/LangGraphPipeline.js';
import { DependencyAwareRetriever } from '../../src/retrieval/DependencyAwareRetriever.js';
import { TargetResolver } from '../../src/retrieval/TargetResolver.js';

class StubEmbedder {
  async initialize(): Promise<void> {}

  async embed(text: string): Promise<number[]> {
    const base = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return [base % 7, (base >> 2) % 7, (base >> 4) % 7];
  }
}

class StubCrossEncoder {
  async score(_query: string, node: GraphNode): Promise<number> {
    return node.path.includes('auth') ? 0.95 : 0.4;
  }
}

function buildTestGraph(): CodeGraph {
  const graph = new CodeGraph();

  const authFile = graph.addNode({
    type: 'file',
    name: 'auth.ts',
    path: 'src/auth.ts',
    content: '',
    startLine: 1,
    endLine: 50,
    metadata: {},
  });

  const authenticateUser = graph.addNode({
    type: 'function',
    name: 'authenticateUser',
    path: 'src/auth.ts',
    content: 'export function authenticateUser() { return true; }',
    startLine: 5,
    endLine: 20,
    metadata: { exported: true },
  });

  const loginFile = graph.addNode({
    type: 'file',
    name: 'login.ts',
    path: 'src/login.ts',
    content: '',
    startLine: 1,
    endLine: 40,
    metadata: {},
  });

  const handleLogin = graph.addNode({
    type: 'function',
    name: 'handleLogin',
    path: 'src/login.ts',
    content: 'function handleLogin() { authenticateUser(); }',
    startLine: 10,
    endLine: 25,
    metadata: { exported: true },
  });

  const uiFile = graph.addNode({
    type: 'file',
    name: 'ui.ts',
    path: 'src/ui.ts',
    content: '',
    startLine: 1,
    endLine: 30,
    metadata: {},
  });

  const renderLogin = graph.addNode({
    type: 'function',
    name: 'renderLogin',
    path: 'src/ui.ts',
    content: 'export function renderLogin() { return handleLogin(); }',
    startLine: 5,
    endLine: 18,
    metadata: { exported: true },
  });

  const edges: GraphEdge[] = [
    { id: 'edge-auth', from: authFile.id, to: authenticateUser.id, type: 'contains', metadata: {} },
    { id: 'edge-login', from: loginFile.id, to: handleLogin.id, type: 'contains', metadata: {} },
    { id: 'edge-ui', from: uiFile.id, to: renderLogin.id, type: 'contains', metadata: {} },
    { id: 'edge-import-auth', from: loginFile.id, to: authFile.id, type: 'imports', metadata: {} },
    { id: 'edge-call-auth', from: handleLogin.id, to: authenticateUser.id, type: 'calls', metadata: {} },
    { id: 'edge-import-login', from: uiFile.id, to: loginFile.id, type: 'imports', metadata: {} },
    { id: 'edge-call-login', from: renderLogin.id, to: handleLogin.id, type: 'calls', metadata: {} },
  ];

  for (const edge of edges) {
    graph.addEdge(edge);
  }

  return graph;
}

class StubGraphManager implements GraphManagerLike {
  constructor(private readonly delegate: GraphManager) {}

  async initialize(forceRebuild?: boolean): Promise<InitializeResult> {
    return this.delegate.initialize(forceRebuild);
  }

  getGraph(): CodeGraph {
    return this.delegate.getGraph();
  }
}

describe('LangGraphPipeline integration', () => {
  let graphManager: GraphManager;
  let embedder: StubEmbedder;
  let buildComponents: RetrievalComponentFactory;

  beforeAll(async () => {
    const graph = buildTestGraph();
    const builder = {
      build: async () => graph,
      buildFileSnapshot: async () => null,
      resolveEdges: () => [],
    } as any;

    graphManager = new GraphManager({
      rootDir: '/tmp',
      store: new InMemoryGraphStore(),
      builder,
    });

    await graphManager.initialize(true);

    embedder = new StubEmbedder();

    buildComponents = async (currentGraph, options): Promise<RetrievalComponents> => {
      const resolver = new TargetResolver(currentGraph, embedder, {
        crossEncoder: options.useCrossEncoder ? (new StubCrossEncoder() as any) : undefined,
      });
      const retriever = new DependencyAwareRetriever(currentGraph, { embedder });
      return { resolver, retriever };
    };
  });

  it('produces a passing evaluation with trace metadata', async () => {
    const pipeline = new LangGraphPipeline(
      {
        graphManager: new StubGraphManager(graphManager),
        buildComponents,
        evaluationAgent: new EvaluationAgent({ precisionThreshold: 0.5, recallThreshold: 0.5, maxK: 3 }),
      },
      { maxIterations: 2 }
    );

    const result = await pipeline.run({
      query: 'refactor authenticateUser',
      groundTruth: { relevantPaths: ['src/auth.ts', 'src/login.ts'] },
    });

    expect(result.evaluation?.pass).toBe(true);
    expect(result.iterations).toBe(1);
    expect(result.trace.getEntries().map(entry => entry.node)).toEqual([
      'graph.load',
      'components.build',
      'retriever.initialize',
      'target.resolve',
      'context.build',
      'agent.evaluate',
    ]);
  });

  it('records expansion actions when thresholds fail', async () => {
    const strictPipeline = new LangGraphPipeline(
      {
        graphManager: new StubGraphManager(graphManager),
        buildComponents,
        evaluationAgent: new EvaluationAgent({ precisionThreshold: 0.95, recallThreshold: 1, maxK: 3, coverageThreshold: 0.5 }),
      },
      { maxIterations: 2, tokenBudgetStep: 1000 }
    );

    const result = await strictPipeline.run({
      query: 'audit authentication pipeline',
      targetFilePath: 'src/auth.ts',
      candidateFilePaths: ['src/auth.ts'],
      groundTruth: { relevantPaths: ['src/auth.ts', 'src/login.ts', 'src/ui.ts', 'src/missing.ts'] },
    });

    expect(result.evaluation?.pass).toBe(false);
    expect(result.iterations).toBeGreaterThan(1);
    const uniqueActions = Array.from(new Set(result.actionsTaken));
    expect(uniqueActions).toEqual(
      expect.arrayContaining(['enable_cross_encoder', 'increase_walk_depth', 'expand_related'])
    );

    const summary = result.trace.getEntries().map(entry => ({ node: entry.node, status: entry.status }));
    expect(summary).toMatchInlineSnapshot(`
      [
        {
          "node": "graph.load",
          "status": "ok",
        },
        {
          "node": "components.build",
          "status": "ok",
        },
        {
          "node": "retriever.initialize",
          "status": "ok",
        },
        {
          "node": "target.resolve",
          "status": "ok",
        },
        {
          "node": "context.build",
          "status": "ok",
        },
        {
          "node": "agent.evaluate",
          "status": "ok",
        },
        {
          "node": "components.build",
          "status": "ok",
        },
        {
          "node": "retriever.initialize",
          "status": "ok",
        },
        {
          "node": "target.resolve",
          "status": "ok",
        },
        {
          "node": "context.build",
          "status": "ok",
        },
        {
          "node": "agent.evaluate",
          "status": "ok",
        },
      ]
    `);
  });
});
