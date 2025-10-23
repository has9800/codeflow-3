import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { CodeGraph } from '../../src/graph/CodeGraph.js';
import { Neo4jGraphStore } from '../../src/graph/store/Neo4jGraphStore.js';

const uri = process.env.CODEFLOW_GRAPH_URI;
const username = process.env.CODEFLOW_GRAPH_USER;
const password = process.env.CODEFLOW_GRAPH_PASSWORD;

const shouldRun = Boolean(uri && username && password);

if (!shouldRun) {
  describe.skip('Neo4j graph store smoke test (credentials missing)', () => {});
} else {
  describe('Neo4j graph store smoke test', () => {
    const namespace = `codeflow-test-${Date.now()}`;
    const store = new Neo4jGraphStore({
      kind: 'neo4j',
      uri: uri!,
      username: username!,
      password: password!,
      namespace,
    });

    beforeAll(async () => {
      await store.clear();
    });

    afterAll(async () => {
      await store.clear();
    });

    it('persists and loads graphs via Neo4j', async () => {
      const graph = new CodeGraph();
      const fileNode = graph.addNode({
        type: 'file',
        name: 'index.ts',
        path: 'src/index.ts',
        content: 'console.log("hello")',
        startLine: 1,
        endLine: 1,
        metadata: {},
      });

      graph.addNode({
        type: 'function',
        name: 'main',
        path: 'src/index.ts',
        content: 'export function main() { return 42; }',
        startLine: 1,
        endLine: 3,
        metadata: { exported: true },
      });

      await store.save(graph);

      const loaded = await store.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.getNodesByPath(fileNode.path).length).toBeGreaterThan(0);
    });
  });
}
