import { describe, it, expect } from 'vitest';
import { loadDataset } from '../../src/benchmark/DatasetLoader.js';
import path from 'node:path';

const fixturesDir = path.resolve('benchmarks/datasets');

describe('DatasetLoader', () => {
  it('loads the bundled smoke dataset', async () => {
    const dataset = await loadDataset(path.join(fixturesDir, 'repobench-smoke.json'));
    expect(dataset.name).toBe('RepoBench Smoke');
    expect(dataset.tasks).toHaveLength(2);
  });

  it('throws when dataset has no tasks', async () => {
    const malformed = path.join(process.cwd(), 'benchmarks/datasets/empty.json');
    await expect((async () => {
      const fs = await import('node:fs/promises');
      await fs.writeFile(malformed, JSON.stringify({ name: 'bad', family: 'x', variant: 'y', tasks: [] }));
      try {
        await loadDataset(malformed);
      } finally {
        await fs.unlink(malformed);
      }
    })()).rejects.toThrow();
  });
});
