import { describe, it, expect } from 'vitest';
import { aggregateMetrics, emptyMetrics } from '../../src/benchmark/Metrics.js';
import type { TaskBenchmarkResult } from '../../src/benchmark/types.js';

const baseMetrics = {
  precisionAtK: 0.5,
  recallAtK: 0.6,
  f1: 0.55,
  coverage: 0.3,
  candidateCount: 3,
  entropy: 1.2,
  snr: 0.8,
  relevanceScore: 0.5,
  answerAccuracy: 0.5,
  exactMatch: 0,
  perplexity: 0,
  faithfulness: 0.6,
  timeToFirstTokenMs: 10,
};

describe('Metrics', () => {
  it('returns empty metrics when no tasks', () => {
    expect(aggregateMetrics([])).toEqual(emptyMetrics());
  });

  it('averages metrics across tasks', () => {
    const results: TaskBenchmarkResult[] = [
      {
        task: { id: 't1', query: 'q', groundTruth: [] },
        metrics: baseMetrics,
        actions: [],
        pass: true,
        iterations: 1,
      },
      {
        task: { id: 't2', query: 'q', groundTruth: [] },
        metrics: { ...baseMetrics, precisionAtK: 1, recallAtK: 1 },
        actions: [],
        pass: true,
        iterations: 1,
      },
    ];

    const aggregate = aggregateMetrics(results);
    expect(aggregate.precisionAtK).toBeCloseTo(0.75);
    expect(aggregate.recallAtK).toBeCloseTo(0.8);
  });
});
