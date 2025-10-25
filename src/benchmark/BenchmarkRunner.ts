import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { LangGraphPipeline } from '../orchestration/LangGraphPipeline.js';
import type { BenchmarkDataset, BenchmarkSummary, TaskBenchmarkResult } from './types.js';
import { aggregateMetrics } from './Metrics.js';

export interface BenchmarkRunnerOptions {
  outputDir?: string;
}

export class BenchmarkRunner {
  constructor(private readonly pipeline: LangGraphPipeline, private readonly options: BenchmarkRunnerOptions = {}) {}

  async run(dataset: BenchmarkDataset): Promise<BenchmarkSummary> {
    const started = performance.now();
    const results: TaskBenchmarkResult[] = [];

    for (const task of dataset.tasks) {
      const { context, resolution, evaluation, iterations, actionsTaken } = await this.pipeline.run({
        query: task.query,
        targetFilePath: task.targetFilePath,
        candidateFilePaths: task.candidateFilePaths,
        groundTruth: { relevantPaths: task.groundTruth },
      });

      if (!evaluation) {
        throw new Error(`Pipeline returned no evaluation for task ${task.id}`);
      }

      const metrics = evaluation.metrics;
      const topCandidatePaths = new Set(resolution.candidates.map(candidate => candidate.path));
      const contextPaths = new Set<string>();
      if (context) {
        contextPaths.add(context.primaryFilePath);
        context.candidateFilePaths.forEach(path => contextPaths.add(path));
      }
      const hits = task.groundTruth.filter(path => topCandidatePaths.has(path) || contextPaths.has(path)).length;
      const denominator = Math.max(1, topCandidatePaths.size || task.groundTruth.length || 1);
      const precisionAtK = hits / denominator;
      const recallAtK = task.groundTruth.length === 0 ? 1 : hits / task.groundTruth.length;
      const f1 = precisionAtK + recallAtK === 0 ? 0 : (2 * precisionAtK * recallAtK) / (precisionAtK + recallAtK);
      const taskMetrics = {
        precisionAtK,
        recallAtK,
        f1,
        coverage: metrics.coverage,
        candidateCount: resolution.candidates.length,
        entropy: context ? entropy(context.formattedContext) : 0,
        snr: context ? signalToNoise(context.formattedContext, context.telemetry.tokens.saved) : 0,
        relevanceScore: precisionAtK,
        answerAccuracy: precisionAtK,
        exactMatch: hits === task.groundTruth.length ? 1 : 0,
        perplexity: 0,
        faithfulness: recallAtK,
        timeToFirstTokenMs: 0,
      };

      results.push({
        task,
        metrics: taskMetrics,
        actions: actionsTaken,
        pass: evaluation?.pass ?? false,
        iterations,
      });
    }

    const aggregate = aggregateMetrics(results);
    const summary: BenchmarkSummary = {
      dataset,
      tasks: results,
      aggregate,
      timestamp: new Date().toISOString(),
      durationMs: performance.now() - started,
    };

    await this.writeArtifacts(summary);
    return summary;
  }

  private async writeArtifacts(summary: BenchmarkSummary): Promise<void> {
    const outputDir = this.options.outputDir ?? path.resolve('.benchmark-artifacts');
    await fs.mkdir(outputDir, { recursive: true });

    const fileName = `${summary.dataset.family}-${summary.dataset.variant}-${Date.now()}.json`;
    await fs.writeFile(path.join(outputDir, fileName), JSON.stringify(summary, null, 2), 'utf-8');
  }
}

function entropy(text: string): number {
  const map = new Map<string, number>();
  for (const char of text) {
    map.set(char, (map.get(char) ?? 0) + 1);
  }
  const len = text.length || 1;
  let sum = 0;
  for (const count of map.values()) {
    const p = count / len;
    sum -= p * Math.log2(p);
  }
  return sum;
}

function signalToNoise(text: string, savedTokens: number): number {
  const signal = text.length;
  const noise = Math.max(1, savedTokens);
  return signal / noise;
}
