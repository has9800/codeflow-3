// tests/integration/dependency-retrieval.test.ts (NEW FILE)
import { describe, it, expect, beforeAll } from 'vitest';
import { CodeGraph } from '../../src/graph/CodeGraph.js';
import { DependencyAwareRetriever } from '../../src/retrieval/DependencyAwareRetriever.js';

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
      metadata: {},
    });
    
    graph.addEdge({
      from: authFile.id,
      to: authenticateUser.id,
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
      metadata: {},
    });
    
    graph.addEdge({
      from: loginFile.id,
      to: loginHandler.id,
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
    
    retriever = new DependencyAwareRetriever(graph);
    await retriever.initialize();
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
    const callerNames = context.backwardDeps.map(n => n.name);
    expect(callerNames).toContain('handleLogin');
  });

  it('should calculate token savings', async () => {
    const context = await retriever.buildContextForChange(
      'fix bug in authenticateUser',
      'src/auth.ts',
      6000
    );
    
    expect(context.tokensSaved).toBeGreaterThan(0);
    expect(context.savingsPercent).toBeGreaterThan(0);
    expect(context.savingsPercent).toBeLessThan(100);
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
});
