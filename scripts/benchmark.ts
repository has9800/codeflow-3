#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { GraphManager } from '../src/graph/GraphManager.js';
import { InMemoryGraphStore } from '../src/graph/store/InMemoryGraphStore.js';
import { DependencyAwareRetriever } from '../src/retrieval/DependencyAwareRetriever.js';
import { TokenCounter } from '../src/retrieval/TokenCounter.js';

async function main() {
  const store = new InMemoryGraphStore();
  const manager = new GraphManager({ rootDir: process.cwd(), store });

  console.log('Building graph...');
  const buildStart = performance.now();
  const { graph } = await manager.initialize(true);
  const buildDuration = performance.now() - buildStart;

  console.log(`Indexed ${graph.getAllNodes().length} symbols in ${buildDuration.toFixed(1)}ms`);

  const retriever = new DependencyAwareRetriever(graph);
  await retriever.initialize();

  const functionNodes = graph
    .getAllNodes()
    .filter(node => node.type === 'function')
    .slice(0, 10);

  if (functionNodes.length === 0) {
    console.log('No function nodes detected; skipping retrieval benchmark.');
    return;
  }

  console.log(`Running retrieval benchmark across ${functionNodes.length} functions...`);
  const counter = new TokenCounter();
  let totalTokens = 0;
  let aggregateDuration = 0;

  for (const node of functionNodes) {
    const query = `Review recent updates to ${node.name}`;
    const start = performance.now();
    const context = await retriever.buildContextForChange(query, node.path, 6000);
    const duration = performance.now() - start;

    totalTokens += counter.count(context.formattedContext);
    aggregateDuration += duration;
  }

  console.log(`Average retrieval time: ${(aggregateDuration / functionNodes.length).toFixed(2)}ms`);
  console.log(`Average tokens prepared: ${(totalTokens / functionNodes.length).toFixed(0)}`);
}

main().catch(error => {
  console.error('Benchmark failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
