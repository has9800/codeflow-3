import crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CodeGraph, type GraphEdge, type GraphNode } from './CodeGraph.js';
import { languageRegistry, type SupportedLanguage } from '../parser/LanguageRegistry.js';
import { createEmbedder } from '../embeddings/TransformersEmbedder.js';
import type { Embedder } from '../embeddings/types.js';
import { EmbeddingCache } from '../embeddings/EmbeddingCache.js';
import { FileGraphSnapshot } from './types.js';

class NoopEmbedder implements Embedder {
  async initialize(): Promise<void> {}
  async embed(_text: string): Promise<number[]> { return []; }
}

interface GraphBuilderDeps {
  embedder?: Embedder;
  cache?: EmbeddingCache | null;
}

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.codeflow',
  'benchmarks',
  'docs',
]);

export class GraphBuilder {
  private embedder: Embedder;
  private readonly embeddingCache: EmbeddingCache | null;
  private embeddingsEnabled = true;

  constructor(private readonly rootDir: string, deps: GraphBuilderDeps = {}) {
    this.embedder = deps.embedder ?? createEmbedder();
    this.embeddingCache = deps.cache ?? new EmbeddingCache(rootDir);
  }

  async build(): Promise<CodeGraph> {
    const graph = new CodeGraph();
    await this.prepareEmbeddingPipeline();

    const filePaths = await this.findSourceFiles();
    for (const filePath of filePaths) {
      const snapshot = await this.buildFileSnapshot(filePath);
      if (!snapshot) continue;
      graph.removeNodesByPath(filePath);
      graph.upsertNode(snapshot.file);
    }

    await this.flushEmbeddingCache();
    return graph;
  }

  async buildFileSnapshot(filePath: string): Promise<FileGraphSnapshot | null> {
    const fullPath = path.join(this.rootDir, filePath);
    let content: string;
    try {
      content = await fs.readFile(fullPath, 'utf-8');
    } catch {
      return null;
    }

    const language = languageRegistry.inferFromPath(filePath);
    if (!language) return null;
    if (language === 'json' || language === 'markdown') return null;

    const digest = this.digest(content);
    const card = this.buildFileCard(filePath, content);

    let embedding: number[] | undefined;
    if (this.embeddingsEnabled) {
      embedding = this.embeddingCache?.get(card);
      if (!embedding) {
        embedding = await this.embedder.embed(card);
        this.embeddingCache?.set(card, embedding);
      }
    }

    const fileNode: GraphNode = {
      id: this.createFileNodeId(filePath),
      type: 'file',
      name: path.basename(filePath),
      path: filePath,
      content,
      startLine: 1,
      endLine: content.split(/\r?\n/).length,
      embedding,
      metadata: {
        language,
        digest,
        embeddingText: card,
      },
    };

    return {
      filePath,
      language,
      file: fileNode,
      symbols: [],
      edges: [],
      digest,
    };
  }

  private async prepareEmbeddingPipeline(): Promise<void> {
    if (process.env.CODEFLOW_DISABLE_EMBEDDINGS === '1') {
      this.embedder = new NoopEmbedder();
      this.embeddingsEnabled = false;
    } else {
      try {
        await this.embedder.initialize();
      } catch (error) {
        console.warn(
          'Embeddings disabled:',
          error instanceof Error ? error.message : String(error)
        );
        this.embedder = new NoopEmbedder();
        this.embeddingsEnabled = false;
      }
    }

    if (this.embeddingCache) {
      await this.embeddingCache.prepare();
      if (!this.embeddingsEnabled) {
        this.embeddingCache.clear();
      }
    }
  }

  private async findSourceFiles(): Promise<string[]> {
    const files: string[] = [];

    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }

        const relative = path.relative(this.rootDir, fullPath);
        const language = languageRegistry.inferFromPath(relative);
        if (language) {
          files.push(relative);
        }
      }
    };

    await walk(this.rootDir);
    return files;
  }

  private buildFileCard(filePath: string, content: string): string {
    const lines = content.split(/\r?\n/);
    const header = lines.slice(0, 50).join('\n');
    const imports = lines.filter(l => /\bimport\b|require\(/.test(l)).slice(0, 20).join('\n');
    const exports = lines.filter(l => /\bexport\b/.test(l)).slice(0, 20).join('\n');
    return [`# file ${filePath}`, '## imports', imports, '## exports', exports, '## header', header].join('\n');
  }

  static buildExportedIndexFromGraph(_graph: CodeGraph): Map<string, string> {
    return new Map();
  }

  resolveEdges(_graph: CodeGraph, _edges: GraphEdge[], _exportedIndex: Map<string, string>): GraphEdge[] {
    return [];
  }

  private createFileNodeId(filePath: string): string {
    return this.digest(`file:${filePath}`);
  }

  private digest(value: string): string {
    return crypto.createHash('sha1').update(value).digest('hex');
  }

  private async flushEmbeddingCache(): Promise<void> {
    if (this.embeddingCache && this.embeddingsEnabled) {
      await this.embeddingCache.flush();
    }
  }
}

