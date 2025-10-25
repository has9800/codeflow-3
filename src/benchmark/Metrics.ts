import type { TaskResultMetrics, TaskBenchmarkResult } from './types.js';

export function aggregateMetrics(results: TaskBenchmarkResult[]): TaskResultMetrics {
  if (results.length === 0) {
    return emptyMetrics();
  }

  const sum = emptyMetrics();

  for (const result of results) {
    const metrics = result.metrics;
    sum.precisionAtK += metrics.precisionAtK;
    sum.recallAtK += metrics.recallAtK;
    sum.f1 += metrics.f1;
    sum.coverage += metrics.coverage;
    sum.candidateCount += metrics.candidateCount;
    sum.entropy += metrics.entropy;
    sum.snr += metrics.snr;
    sum.relevanceScore += metrics.relevanceScore;
    sum.answerAccuracy += metrics.answerAccuracy;
    sum.exactMatch += metrics.exactMatch;
    sum.perplexity += metrics.perplexity;
    sum.faithfulness += metrics.faithfulness;
    sum.timeToFirstTokenMs += metrics.timeToFirstTokenMs;
  }

  return {
    precisionAtK: sum.precisionAtK / results.length,
    recallAtK: sum.recallAtK / results.length,
    f1: sum.f1 / results.length,
    coverage: sum.coverage / results.length,
    candidateCount: sum.candidateCount / results.length,
    entropy: sum.entropy / results.length,
    snr: sum.snr / results.length,
    relevanceScore: sum.relevanceScore / results.length,
    answerAccuracy: sum.answerAccuracy / results.length,
    exactMatch: sum.exactMatch / results.length,
    perplexity: sum.perplexity / results.length,
    faithfulness: sum.faithfulness / results.length,
    timeToFirstTokenMs: sum.timeToFirstTokenMs / results.length,
  };
}

export function emptyMetrics(): TaskResultMetrics {
  return {
    precisionAtK: 0,
    recallAtK: 0,
    f1: 0,
    coverage: 0,
    candidateCount: 0,
    entropy: 0,
    snr: 0,
    relevanceScore: 0,
    answerAccuracy: 0,
    exactMatch: 0,
    perplexity: 0,
    faithfulness: 0,
    timeToFirstTokenMs: 0,
  };
}
