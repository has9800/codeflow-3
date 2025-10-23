import { describe, it, expect } from 'vitest';
import { CodeGraph } from '../../src/graph/CodeGraph.js';

describe('CodeGraph', () => {
  it('adds and retrieves nodes', () => {
    const graph = new CodeGraph();
    const node = graph.addNode({
      type: 'file',
      name: 'index.ts',
      path: 'src/index.ts',
      content: '',
      startLine: 1,
      endLine: 1,
      metadata: {},
    });

    expect(graph.getNode(node.id)).toEqual(node);
    expect(graph.getNodesByPath('src/index.ts')).toHaveLength(1);
  });

  it('connects nodes with edges and removes them', () => {
    const graph = new CodeGraph();
    const file = graph.addNode({
      type: 'file',
      name: 'index.ts',
      path: 'src/index.ts',
      content: '',
      startLine: 1,
      endLine: 1,
      metadata: {},
    });
    const fn = graph.addNode({
      type: 'function',
      name: 'main',
      path: 'src/index.ts',
      content: 'function main() {}',
      startLine: 1,
      endLine: 1,
      metadata: {},
    });

    graph.addEdge({
      from: file.id,
      to: fn.id,
      type: 'contains',
      metadata: {},
    });

    expect(graph.getNeighbors(file.id)).toHaveLength(1);

    graph.removeNode(fn.id);
    expect(graph.getNeighbors(file.id)).toHaveLength(0);
  });

  it('clones graph state', () => {
    const graph = new CodeGraph();
    graph.addNode({
      type: 'file',
      name: 'index.ts',
      path: 'src/index.ts',
      content: '',
      startLine: 1,
      endLine: 1,
      metadata: {},
    });

    const clone = graph.clone();
    expect(clone.getAllNodes()).toHaveLength(1);
    expect(clone).not.toBe(graph);
  });
});
