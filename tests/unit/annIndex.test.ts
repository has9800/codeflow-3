import { describe, it, expect } from 'vitest';
import { HnswAnnIndex } from '../../src/retrieval/AnnIndex.js';

describe('HnswAnnIndex', () => {
  it('returns nearest neighbours based on cosine similarity', () => {
    const index = new HnswAnnIndex(8, 100, 32);
    index.add('alpha', [1, 0, 0]);
    index.add('beta', [0, 1, 0]);
    index.add('gamma', [0, 0, 1]);

    const results = index.search([0.9, 0.2, 0.1], 2);
    expect(results[0]?.id).toBe('alpha');
    expect(results[1]?.id).toBe('beta');
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it('supports removal and reindexing', () => {
    const index = new HnswAnnIndex();
    index.add('one', [1, 0]);
    index.add('two', [0, 1]);

    index.remove('one');
    const results = index.search([0.1, 0.9], 1);
    expect(results[0]?.id).toBe('two');
  });

  it('enforces consistent vector dimensions', () => {
    const index = new HnswAnnIndex();
    index.add('origin', [1, 0, 0]);

    expect(() => index.add('mismatch', [1, 0])).toThrow(/Vector dimension mismatch/);
    expect(() => index.search([1, 0], 1)).toThrow(/Query dimension mismatch/);
  });
});

