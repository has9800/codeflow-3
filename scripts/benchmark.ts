#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { GraphManager } from '../src/graph/GraphManager.js';
import { InMemoryGraphStore } from '../src/graph/store/InMemoryGraphStore.js';
import { createDefaultRetrievalFactory } from '../src/orchestration/defaultFactory.js';
import { LangGraphPipeline } from '../src/orchestration/LangGraphPipeline.js';
import { EvaluationAgent } from '../src/orchestration/EvaluationAgent.js';
import { loadDataset } from '../src/benchmark/DatasetLoader.js';
import { BenchmarkRunner } from '../src/benchmark/BenchmarkRunner.js';
import { ReportGenerator } from '../src/benchmark/ReportGenerator.js';

interface CliArgs {
  dataset?: string;
  outputDir?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dataset' || arg === '-d') {
      args.dataset = argv[++i];
    } else if (arg === '--output' || arg === '-o') {
      args.outputDir = argv[++i];
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const start = performance.now();

  const store = new InMemoryGraphStore();
  const manager = new GraphManager({ rootDir: process.cwd(), store });
  const dataset = await loadDataset(args.dataset);

  console.log(`Loaded dataset ${dataset.name} with ${dataset.tasks.length} tasks.`);

  console.log('Ensuring graph baseline...');
  await manager.initialize(true);

  const pipeline = new LangGraphPipeline(
    {
      graphManager: manager,
      buildComponents: createDefaultRetrievalFactory(),
      evaluationAgent: new EvaluationAgent({
        precisionThreshold: 0.6,
        recallThreshold: 0.6,
        maxK: 5,
        coverageThreshold: 0.9,
      }),
    },
    {
      maxIterations: 2,
    }
  );

  const runnerOptions = { outputDir: args.outputDir };
  const runner = new BenchmarkRunner(pipeline, runnerOptions);
  const summary = await runner.run(dataset);

  const reporter = new ReportGenerator({ outputDir: args.outputDir });
  const reportPath = await reporter.writeMarkdown(summary);

  console.log('Benchmark summary:');
  console.log(` - Aggregate precision@k: ${summary.aggregate.precisionAtK.toFixed(2)}`);
  console.log(` - Aggregate recall@k: ${summary.aggregate.recallAtK.toFixed(2)}`);
  console.log(` - Tasks completed: ${summary.tasks.length}`);
  console.log(` - Duration: ${(summary.durationMs / 1000).toFixed(2)}s`);
  console.log(`Report written to ${path.relative(process.cwd(), reportPath)}`);
  console.log(`Artifacts stored under ${runner['options']?.outputDir ?? '.benchmark-artifacts'}`);
  console.log(`Total runtime ${(performance.now() - start).toFixed(0)}ms`);
}

main().catch(error => {
  console.error('Benchmark failed:', error instanceof Error ? error.stack : String(error));
  process.exit(1);
});