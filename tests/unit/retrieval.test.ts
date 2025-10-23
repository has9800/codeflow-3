import { describe, it, expect } from 'vitest';
import { TextSearchEngine } from '../../src/retrieval/TextSearchEngine.js';
import { TokenCounter } from '../../src/retrieval/TokenCounter.js';
import { VectorStore } from '../../src/embeddings/VectorStore.js';

describe('TextSearchEngine', () => {
  it('ranks nodes by textual relevance', () => {
    const engine = new TextSearchEngine();
    const nodes = [
      { id: '1', type: 'function', name: 'foo', path: 'a.ts', content: 'initialize the database connection', startLine: 1, endLine: 3, metadata: {} },
      { id: '2', type: 'function', name: 'bar', path: 'b.ts', content: 'render the user interface', startLine: 1, endLine: 3, metadata: {} },
    ];

    const result = engine.search('connect to database', nodes as any, 1);
    expect(result.nodes[0]?.id).toBe('1');
  });
});

describe('TokenCounter', () => {
  it('approximates token counts', () => {
    const counter = new TokenCounter();
    const value = counter.count('hello world');
    expect(value).toBeGreaterThan(0);
  });
});

describe('VectorStore search', () => {
  it('returns empty array when no vectors added', () => {
    const store = new VectorStore();
    const result = store.search([1, 0, 0], 3);
    expect(result).toHaveLength(0);
  });
});
