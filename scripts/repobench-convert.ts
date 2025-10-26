#!/usr/bin/env tsx
/**
 * Convert a RepoBench-style JSON into our internal BenchmarkDataset format.
 * Usage: tsx scripts/repobench-convert.ts <input.json> [output.json]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

type SourceItem = {
  id?: string;
  query?: string;
  question?: string;
  files?: string[];
  answer_files?: string[];
  tags?: string[];
  repo?: string;
};

type Source = {
  items?: SourceItem[];
  tasks?: SourceItem[];
};

type BenchmarkTask = {
  id: string;
  query: string;
  targetFilePath?: string;
  candidateFilePaths?: string[];
  groundTruth: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
};

type BenchmarkDataset = {
  name: string;
  family: string;
  variant: string;
  description?: string;
  tasks: BenchmarkTask[];
  metadata?: Record<string, unknown>;
};

async function main() {
  const input = process.argv[2];
  const output = process.argv[3] ?? 'benchmarks/datasets/repobench-sample.json';
  if (!input) {
    console.error('Usage: tsx scripts/repobench-convert.ts <input.json> [output.json]');
    process.exit(1);
  }

  const raw = await readFile(input, 'utf-8');
  const sanitized = raw.replace(/^\uFEFF/, '');
  const src: Source = JSON.parse(sanitized);
  const list: SourceItem[] = (src.items ?? src.tasks ?? []).slice(0, 50);

  const tasks: BenchmarkTask[] = list.map((it, i) => {
    const gt = Array.from(new Set(it.answer_files ?? []));
    const all = Array.from(new Set(it.files ?? []));
    const target = gt[0] ?? all[0] ?? undefined;
    const candidates = Array.from(new Set([target, ...all].filter(Boolean) as string[])).slice(0, 12);
    return {
      id: it.id ?? `rb-${i}`,
      query: it.query ?? it.question ?? 'Review recent changes',
      targetFilePath: target,
      candidateFilePaths: candidates,
      groundTruth: gt.length > 0 ? gt : (target ? [target] : []),
      tags: it.tags,
      metadata: { source: 'RepoBench', repo: it.repo ?? '' },
    };
  });

  const dataset: BenchmarkDataset = {
    name: 'RepoBench Sample',
    family: 'repobench',
    variant: 'sample',
    description: 'Converted RepoBench sample',
    tasks,
  };

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(dataset, null, 2), 'utf-8');
  console.log(`Wrote ${output} with ${tasks.length} tasks`);
}

main().catch(err => {
  console.error('Conversion failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
