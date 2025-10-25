import fs from 'node:fs/promises';
import path from 'node:path';
import type { BenchmarkSummary } from './types.js';

export interface ReportOptions {
  outputDir?: string;
}

export class ReportGenerator {
  constructor(private readonly options: ReportOptions = {}) {}

  async writeMarkdown(summary: BenchmarkSummary): Promise<string> {
    const outputDir = this.options.outputDir ?? path.resolve('.benchmark-artifacts');
    await fs.mkdir(outputDir, { recursive: true });

    const fileName = `${summary.dataset.family}-${summary.dataset.variant}-${Date.now()}.md`;
    const fullPath = path.join(outputDir, fileName);

    const lines: string[] = [];
    lines.push(`# Benchmark Report — ${summary.dataset.name}`);
    lines.push('');
    lines.push(`- Family: **${summary.dataset.family}**`);
    lines.push(`- Variant: **${summary.dataset.variant}**`);
    lines.push(`- Tasks: **${summary.tasks.length}**`);
    lines.push(`- Duration: **${summary.durationMs.toFixed(0)} ms**`);
    lines.push(`- Timestamp: ${summary.timestamp}`);
    lines.push('');
    lines.push('## Aggregate Metrics');
    lines.push('');
    lines.push(renderMetricsTable(summary.aggregate));
    lines.push('');
    lines.push('## Task Results');
    lines.push('');
    for (const result of summary.tasks) {
      lines.push(`### ${result.task.id}`);
      lines.push('');
      lines.push(`Query: \

> ${result.task.query}`);
      lines.push('');
      lines.push(`Target: ${result.task.targetFilePath ?? 'auto-detected'}`);
      lines.push(`Ground truth: ${result.task.groundTruth.join(', ')}`);
      lines.push(`Iterations: ${result.iterations}`);
      lines.push(`Pass: ${result.pass ? '✅' : '❌'}`);
      lines.push('');
      lines.push(renderMetricsTable(result.metrics));
      lines.push('');
      if (result.actions.length > 0) {
        lines.push(`Actions: ${result.actions.join(', ')}`);
        lines.push('');
      }
    }

    await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');
    return fullPath;
  }
}

function renderMetricsTable(metrics: Record<string, number>): string {
  const headers = '| Metric | Value |\n| --- | --- |';
  const rows = Object.entries(metrics)
    .map(([key, value]) => `| ${key} | ${typeof value === 'number' ? value.toFixed(4) : value} |`)
    .join('\n');
  return `${headers}\n${rows}`;
}
