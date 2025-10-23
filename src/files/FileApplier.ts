import * as fs from 'fs/promises';
import * as path from 'path';
import { parsePatch, applyPatch } from 'diff';
import { TreeSitterParser } from '../parser/TreeSitterParser.js';
import { BackupManager } from './BackupManager.js';

export interface FileEdit {
  type: 'diff' | 'replace' | 'create' | 'delete';
  path: string;
  content?: string;
  diff?: string;
}

export interface ApplyResult {
  success: boolean;
  path: string;
  error?: string;
  syntaxValid: boolean;
}

export class FileApplier {
  private parser: TreeSitterParser;
  private backup: BackupManager;

  constructor(private rootDir: string) {
    this.parser = new TreeSitterParser();
    this.backup = new BackupManager(rootDir);
  }

  async apply(edit: FileEdit): Promise<ApplyResult> {
    const fullPath = path.join(this.rootDir, edit.path);

    try {
      // Create backup
      if (await this.fileExists(fullPath)) {
        await this.backup.backup(edit.path);
      }

      let newContent: string;

      switch (edit.type) {
        case 'diff':
          newContent = await this.applyDiff(fullPath, edit.diff!);
          break;
        case 'replace':
          newContent = edit.content!;
          break;
        case 'create':
          await this.ensureDir(path.dirname(fullPath));
          newContent = edit.content!;
          break;
        case 'delete':
          await fs.unlink(fullPath);
          return { success: true, path: edit.path, syntaxValid: true };
      }

      // Validate syntax
      const syntaxValid = await this.validateSyntax(edit.path, newContent);

      if (!syntaxValid) {
        console.warn(`Warning: Syntax validation failed for ${edit.path}`);
      }

      // Write file
      await fs.writeFile(fullPath, newContent, 'utf-8');

      return {
        success: true,
        path: edit.path,
        syntaxValid,
      };
    } catch (error) {
      // Rollback on error
      await this.backup.restore(edit.path);
      
      return {
        success: false,
        path: edit.path,
        error: error instanceof Error ? error.message : String(error),
        syntaxValid: false,
      };
    }
  }

  private async applyDiff(filePath: string, diffText: string): Promise<string> {
    const originalContent = await fs.readFile(filePath, 'utf-8');
    const patches = parsePatch(diffText);

    if (patches.length === 0) {
      throw new Error('Invalid diff format');
    }

    const result = applyPatch(originalContent, patches[0]);

    if (result === false) {
      throw new Error('Failed to apply patch - may not match current file');
    }

    return result;
  }

  private async validateSyntax(filePath: string, content: string): Promise<boolean> {
    const ext = path.extname(filePath);
    const language = this.getLanguage(ext);

    if (!language) {
      // Unknown language, skip validation
      return true;
    }

    try {
      const tree = await this.parser.parse(content, language);
      return !tree.rootNode.hasError;
    } catch {
      return false;
    }
  }

  private getLanguage(ext: string): string | null {
    const map: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.py': 'python',
      '.rs': 'rust',
      '.go': 'go',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
    };
    return map[ext] || null;
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  async rollback(filePath: string): Promise<void> {
    await this.backup.restore(filePath);
  }
}
