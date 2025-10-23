import { vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const testHome = path.join(process.cwd(), '.tmp-home');
if (!fs.existsSync(testHome)) {
  fs.mkdirSync(testHome, { recursive: true, mode: 0o700 });
}

const testConfigDir = path.join(testHome, '.config');
if (!fs.existsSync(testConfigDir)) {
  fs.mkdirSync(testConfigDir, { recursive: true, mode: 0o700 });
}

process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
process.env.CODEFLOW_HOME = testHome;
process.env.XDG_CONFIG_HOME = testConfigDir;
process.env.XDG_DATA_HOME = testConfigDir;

process.env.CODEFLOW_DISABLE_EMBEDDINGS = process.env.CODEFLOW_DISABLE_EMBEDDINGS ?? '1';

const mockPipeline = vi.fn(async () => {
  return async () => ({
    data: new Float32Array(1).fill(0),
  });
});

vi.mock('@xenova/transformers', () => ({
  pipeline: mockPipeline,
}));
