import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import * as fs from 'fs/promises';
import { SyntaxValidator } from '../../src/files/SyntaxValidator.js';
import { GitIntegration } from '../../src/files/GitIntegration.js';

describe('SyntaxValidator', () => {
  const validator = new SyntaxValidator();

  it('accepts valid TypeScript code', async () => {
    const result = await validator.validate('const answer: number = 42;', 'sample.ts');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('flags invalid TypeScript code', async () => {
    const result = await validator.validate('const = 42', 'sample.ts');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('GitIntegration', () => {
  it('detects non-git directories', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeflow-git-'));
    const git = new GitIntegration(tmpDir);
    expect(await git.isRepository()).toBe(false);
  });
});
