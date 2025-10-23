import { describe, it, beforeEach, expect } from 'vitest';
import { EmbeddingCache } from '../../src/embeddings/EmbeddingCache.js';
import { VectorStore } from '../../src/embeddings/VectorStore.js';

describe('EmbeddingCache', () => {
  let cache: EmbeddingCache;

  beforeEach(async () => {
    cache = new EmbeddingCache('unit-embeddings-test');
    await cache.prepare();
    cache.clear();
    await cache.flush();
  });

  it('persists embeddings between sessions', async () => {
    const sampleText = 'function answer() { return 42; }';
    const embedding = [0.1, 0.2, 0.3];

    cache.set(sampleText, embedding);
    await cache.flush();

    const reloaded = new EmbeddingCache('unit-embeddings-test');
    await reloaded.prepare();

    expect(reloaded.get(sampleText)).toEqual(embedding);
  });
});

describe('VectorStore', () => {
  it('scores vectors by cosine similarity', () => {
    const store = new VectorStore();
    store.add({ id: 'a', embedding: [1, 0, 0] });
    store.add({ id: 'b', embedding: [0, 1, 0] });

    const results = store.search([0.9, 0.1, 0], 1);
    expect(results[0]?.record.id).toBe('a');
    expect(results[0]?.score ?? 0).toBeGreaterThan(0.5);
  });
});
