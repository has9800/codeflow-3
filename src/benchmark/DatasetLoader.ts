import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { BenchmarkDataset } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATASET_PATH = path.resolve(
  __dirname,
  '../../benchmarks/datasets/repobench-smoke.json'
);

export async function loadDataset(datasetPath?: string): Promise<BenchmarkDataset> {
  const resolved = datasetPath ? path.resolve(datasetPath) : DEFAULT_DATASET_PATH;
  const raw = await readFile(resolved, 'utf-8');
  const data = JSON.parse(raw) as BenchmarkDataset;
  validateDataset(data, resolved);
  return data;
}

function validateDataset(dataset: BenchmarkDataset, source: string): void {
  if (!dataset.tasks || dataset.tasks.length === 0) {
    throw new Error(`Benchmark dataset ${source} has no tasks.`);
  }
  dataset.tasks.forEach(task => {
    if (!task.id) {
      throw new Error(`Benchmark task missing id in dataset ${dataset.name}`);
    }
    if (!task.query) {
      throw new Error(`Benchmark task ${task.id} missing query.`);
    }
    if (!task.groundTruth || task.groundTruth.length === 0) {
      throw new Error(`Benchmark task ${task.id} missing groundTruth entries.`);
    }
  });
}

export { DEFAULT_DATASET_PATH };
