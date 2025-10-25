// tests/integration/dependency-retrieval.test.ts (NEW FILE)
import { describe, it, expect, beforeAll } from 'vitest';
import { CodeGraph } from '../../src/graph/CodeGraph.js';
import { DependencyAwareRetriever } from '../../src/retrieval/DependencyAwareRetriever.js';

class StubEmbedder {
  async initialize(): Promise<void> {}

  async embed(text: string): Promise<number[]> {
    const hash = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return [hash % 10, (hash >> 2) % 10, (hash >> 4) % 10];
  }
}

describe('Dependency-Aware Retrieval', () => {
  let graph: CodeGraph;
  let retriever: DependencyAwareRetriever;

  beforeAll(async () => {
    // Build test graph
    graph = new CodeGraph();
    
    // Create test structure:
    // auth.ts exports authenticateUser()
    // login.ts imports and calls authenticateUser()
    // api.ts imports and calls authenticateUser()
    
    const authFile = graph.addNode({
      type: 'file',
      name: 'auth.ts',
      path: 'src/auth.ts',
      content: '',
      startLine: 1,
      endLine: 20,
      metadata: {},
    });
    
    const authenticateUser = graph.addNode({
      type: 'function',
      name: 'authenticateUser',
      path: 'src/auth.ts',
      content: 'export function authenticateUser(email, password) { ... }',
      startLine: 5,
      endLine: 15,
      metadata: { exported: true },
    });

    const logoutUser = graph.addNode({
      type: 'function',
      name: 'logoutUser',
      path: 'src/auth.ts',
      content: 'export function logoutUser() { /* ... */ }',
      startLine: 16,
      endLine: 22,
      metadata: { exported: true },
    });
    
    graph.addEdge({
      from: authFile.id,
      to: authenticateUser.id,
      type: 'contains',
      metadata: {},
    });

    graph.addEdge({
      from: authFile.id,
      to: logoutUser.id,
      type: 'contains',
      metadata: {},
    });
    
    const loginFile = graph.addNode({
      type: 'file',
      name: 'login.ts',
      path: 'src/login.ts',
      content: '',
      startLine: 1,
      endLine: 30,
      metadata: {},
    });
    
    const loginHandler = graph.addNode({
      type: 'function',
      name: 'handleLogin',
      path: 'src/login.ts',
      content: 'function handleLogin() { authenticateUser(...) }',
      startLine: 10,
      endLine: 20,
      metadata: { exported: true },
    });
    
    graph.addEdge({
      from: loginFile.id,
      to: loginHandler.id,
      type: 'contains',
      metadata: {},
    });
    
    const uiFile = graph.addNode({
      type: 'file',
      name: 'ui.ts',
      path: 'src/ui.ts',
      content: '',
      startLine: 1,
      endLine: 25,
      metadata: {},
    });

    const renderLogin = graph.addNode({
      type: 'function',
      name: 'renderLogin',
      path: 'src/ui.ts',
      content: 'export function renderLogin() { return handleLogin(); }',
      startLine: 4,
      endLine: 12,
      metadata: { exported: true },
    });

    graph.addEdge({
      from: uiFile.id,
      to: renderLogin.id,
      type: 'contains',
      metadata: {},
    });

    // Create dependency edges
    graph.addEdge({
      from: loginFile.id,
      to: authFile.id,
      type: 'imports',
      metadata: {},
    });
    
    graph.addEdge({
      from: loginHandler.id,
      to: authenticateUser.id,
      type: 'calls',
      metadata: {},
    });

    graph.addEdge({
      from: uiFile.id,
      to: loginFile.id,
      type: 'imports',
      metadata: {},
    });

    graph.addEdge({
      from: renderLogin.id,
      to: loginHandler.id,
      type: 'calls',
      metadata: {},
    });

    const previousDisable = process.env.CODEFLOW_DISABLE_EMBEDDINGS;
    process.env.CODEFLOW_DISABLE_EMBEDDINGS = '0';
    retriever = new DependencyAwareRetriever(graph, { embedder: new StubEmbedder() });
    await retriever.initialize();
    process.env.CODEFLOW_DISABLE_EMBEDDINGS = previousDisable ?? '1';
  });

  it('should include backward dependencies (callers)', async () => {
    const context = await retriever.buildContextForChange(
      'refactor authenticateUser function',
      'src/auth.ts',
      10000
    );
    
    // Should include the target
    expect(context.targetNodes.length).toBeGreaterThan(0);
    expect(context.targetNodes[0].name).toBe('authenticateUser');

    // Should include callers (backward deps)
    expect(context.backwardDeps.length).toBeGreaterThan(0);
    expect(context.backwardDeps.length).toBeLessThanOrEqual(3);
    expect(context.forwardDeps.length).toBeLessThanOrEqual(3);
    expect(context.relatedByQuery.length).toBeLessThanOrEqual(3);
    const callerNames = context.backwardDeps.map(n => n.name);
    expect(callerNames).toContain('handleLogin');
  });

  it('should calculate token savings', async () => {
    const context = await retriever.buildContextForChange(
      'fix bug in authenticateUser',
      'src/auth.ts',
      6000
    );

    expect(context.tokensSaved).toBeGreaterThanOrEqual(0);
    expect(context.savingsPercent).toBeGreaterThanOrEqual(0);
    expect(context.savingsPercent).toBeLessThan(100);
    expect(context.telemetry.tokens.budget).toBe(6000);
  });

  it('clamps token budgets to the supported window', async () => {
    const context = await retriever.buildContextForChange(
      'tight budget test',
      'src/auth.ts',
      4000
    );

    expect(context.telemetry.tokens.budget).toBe(6000);
    expect(context.totalTokens).toBeLessThanOrEqual(context.telemetry.tokens.budget);
  });

  it('should format context with clear sections', async () => {
    const context = await retriever.buildContextForChange(
      'update authenticateUser',
      'src/auth.ts',
      10000
    );
    
    expect(context.formattedContext).toContain('# TARGET CODE');
    expect(context.formattedContext).toContain('# DEPENDENTS');
    expect(context.formattedContext).toContain('authenticateUser');
  });

  it('expands semantic context using call graph metadata', async () => {
    const context = await retriever.buildContextForChange(
      'consider updates to authenticateUser validation',
      'src/auth.ts',
      8000
    );

    const relatedNames = context.relatedByQuery.map(node => node.name);
    expect(relatedNames).toContain('logoutUser');
  });

  it('emits telemetry snapshot for downstream metrics', async () => {
    const context = await retriever.buildContextForChange(
      'refine authenticateUser flow',
      'src/auth.ts',
      9000
    );

    expect(context.telemetry).toMatchInlineSnapshot(`
      {
        "targetResolution": {
          "aggregateSourceScores": {
            "BM25": 1.4040645531203197,
          },
          "candidateCount": 2,
          "primaryPath": "src/auth.ts",
          "sourceScores": {
            "BM25": 0.6230536454471418,
          },
        },
        "tokens": {
          "budget": 9000,
          "saved": 0,
          "savingsPercent": 0,
          "used": 173,
        },
      }
    `);
  });
});
