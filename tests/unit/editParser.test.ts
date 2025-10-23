import { describe, it, expect } from 'vitest';
import { parseFileEdits } from '../../src/files/EditParser.js';

describe('parseFileEdits', () => {
  it('extracts unified diff blocks with target paths', () => {
    const response = [
      '```diff',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,2 +1,2 @@',
      "-console.log('old');",
      "+console.log('new');",
      '```',
    ].join('\n');

    const edits = parseFileEdits(response);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      type: 'diff',
      path: 'src/foo.ts',
    });
    expect(edits[0]?.diff).toContain('console.log');
  });

  it('extracts full file replacements and trims trailing newlines', () => {
    const response = [
      'FILE: src/bar.ts',
      '```ts',
      'export const answer = 42;',
      '',
      '```',
    ].join('\n');

    const edits = parseFileEdits(response);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      type: 'replace',
      path: 'src/bar.ts',
    });
    expect(edits[0]?.content).toBe('export const answer = 42;');
  });

  it('prefers diff over replace when both exist for the same path', () => {
    const response = [
      'FILE: src/foo.ts',
      '```',
      'console.log("replacement");',
      '```',
      '',
      '```diff',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '+console.log("diff");',
      '```',
    ].join('\n');

    const edits = parseFileEdits(response);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      type: 'diff',
      path: 'src/foo.ts',
    });
  });
});
