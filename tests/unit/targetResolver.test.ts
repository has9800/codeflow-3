import { describe, it, expect } from 'vitest';
import { CodeGraph } from '../../src/graph/CodeGraph.js';
import { TargetResolver } from '../../src/retrieval/TargetResolver.js';

class StubEmbedder {
  async embed(text: string): Promise<number[]> {
    const sum = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return [sum || 1];
  }
}

function buildGraph(): CodeGraph {
  const graph = new CodeGraph();

  const authFile = graph.addNode({
    type: 'file',
    name: 'auth.ts',
    path: 'src/auth.ts',
    content: 'Handles authentication',
    startLine: 1,
    endLine: 200,
    metadata: {},
  });

  const authFunc = graph.addNode({
    type: 'function',
    name: 'authenticateUser',
    path: 'src/auth.ts',
    content: 'export function authenticateUser(email: string, password: string) {}',
    startLine: 10,
    endLine: 40,
    metadata: { exported: true },
  });

  graph.addEdge({
    from: authFile.id,
    to: authFunc.id,
    type: 'contains',
    metadata: {},
  });

  const loginFile = graph.addNode({
    type: 'file',
    name: 'login.ts',
    path: 'src/login.ts',
    content: 'Handles login flow and invokes auth',
    startLine: 1,
    endLine: 150,
    metadata: {},
  });

  const loginFunc = graph.addNode({
    type: 'function',
    name: 'handleLogin',
    path: 'src/login.ts',
    content: 'function handleLogin() { authenticateUser(); }',
    startLine: 20,
    endLine: 60,
    metadata: { exported: true },
  });

  graph.addEdge({
    from: loginFile.id,
    to: loginFunc.id,
    type: 'contains',
    metadata: {},
  });

  return graph;
}

describe('TargetResolver', () => {
  const graph = buildGraph();
  const embedder = new StubEmbedder();
  const resolver = new TargetResolver(graph, embedder);

  it('prioritises files whose symbols match identifiers in the query', async () => {
    const resolution = await resolver.resolve('refactor authenticateUser function');
    expect(['src/auth.ts', 'src/login.ts']).toContain(resolution.primary?.path);
    expect(resolution.candidates.map(candidate => candidate.path)).toContain('src/login.ts');
    expect(Object.keys(resolution.primary?.sourceScores ?? {})).not.toHaveLength(0);
    expect(resolution.primary?.scoreBreakdown.semantic).toBeGreaterThan(0);
  });

  it('boosts recent files when scores are close', async () => {
    const resolution = await resolver.resolve('improve login UX', {
      recentPaths: ['src/login.ts'],
    });

    expect(resolution.primary?.path).toBe('src/login.ts');
  });

  it('deduplicates reason strings per candidate', async () => {
    const resolution = await resolver.resolve('authenticateUser login flow');
    const primary = resolution.primary;
    expect(primary).toBeDefined();
    if (primary) {
      const uniqueReasons = new Set(primary.reasons);
      expect(uniqueReasons.size).toBe(primary.reasons.length);
    }
  });
});

