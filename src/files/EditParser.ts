import { FileEdit } from './FileApplier.js';

const DIFF_BLOCK = /```(?:diff|patch)\s+([\s\S]*?)```/gi;
const FILE_BLOCK = /FILE:\s*(.+?)\s*\n+```[a-zA-Z]*\n([\s\S]*?)```/gi;

/**
 * Parse a model response and extract structured file edits.
 */
export function parseFileEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  edits.push(...parseDiffEdits(content));
  edits.push(...parseReplaceEdits(content));
  return dedupeEdits(edits);
}

function parseDiffEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  let match: RegExpExecArray | null;

  while ((match = DIFF_BLOCK.exec(content)) !== null) {
    const diffText = match[1].trim();
    if (!diffText) continue;

    const path = extractDiffPath(diffText);
    if (!path) continue;

    edits.push({
      type: 'diff',
      path,
      diff: diffText,
    });
  }

  return edits;
}

function parseReplaceEdits(content: string): FileEdit[] {
  const edits: FileEdit[] = [];
  let match: RegExpExecArray | null;

  while ((match = FILE_BLOCK.exec(content)) !== null) {
    const [, rawPath, body] = match;
    const cleanedBody = body.replace(/\s+$/, '');

    edits.push({
      type: 'replace',
      path: rawPath.trim(),
      content: cleanedBody,
    });
  }

  return edits;
}

function dedupeEdits(edits: FileEdit[]): FileEdit[] {
  const seen = new Map<string, FileEdit>();

  for (const edit of edits) {
    if (!edit.path) continue;
    const existing = seen.get(edit.path);
    if (!existing) {
      seen.set(edit.path, edit);
      continue;
    }

    // Prefer diff over replace when both exist for same path
    if (existing.type === 'replace' && edit.type === 'diff') {
      seen.set(edit.path, edit);
    }
  }

  return Array.from(seen.values());
}

function extractDiffPath(diffText: string): string | null {
  const newPath = diffText.match(/^\+\+\+\s+b\/(.+)$/m);
  if (newPath?.[1]) return newPath[1].trim();

  const oldPath = diffText.match(/^---\s+a\/(.+)$/m);
  if (oldPath?.[1]) return oldPath[1].trim();

  return null;
}
