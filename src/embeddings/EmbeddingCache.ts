import crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';
import { ensureDir, writeJsonFile, readJsonFile } from '../utils/fs.js';

interface CacheRecord {
  hash: string;
  embedding: number[];
  updatedAt: number;
}

export class EmbeddingCache {
  private readonly cachePath: string;
  private loaded = false;
  private readonly records = new Map<string, CacheRecord>();
  private dirty = false;

  constructor(private readonly projectRoot: string) {
    const baseHome = process.env.CODEFLOW_HOME || os.homedir();
    const cacheDir = path.join(
      baseHome,
      '.codeflow',
      'embeddings',
      projectRoot.replace(/[:\\/]+/g, '_')
    );
    this.cachePath = path.join(cacheDir, 'cache.json');
  }

  async prepare(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    const existing = await readJsonFile<CacheRecord[]>(this.cachePath);
    if (existing) {
      for (const record of existing) {
        this.records.set(record.hash, record);
      }
    }
  }

  get(text: string): number[] | undefined {
    const hash = this.hash(text);
    return this.records.get(hash)?.embedding;
  }

  set(text: string, embedding: number[]): void {
    const hash = this.hash(text);
    this.records.set(hash, {
      hash,
      embedding,
      updatedAt: Date.now(),
    });
    this.dirty = true;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    await ensureDir(path.dirname(this.cachePath));
    await writeJsonFile(this.cachePath, Array.from(this.records.values()));
    this.dirty = false;
  }

  clear(): void {
    this.records.clear();
    this.dirty = true;
  }

  private hash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
