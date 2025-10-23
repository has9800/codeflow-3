export interface VectorRecord {
  id: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface SearchResult<T extends VectorRecord = VectorRecord> {
  record: T;
  score: number;
}

export class VectorStore<T extends VectorRecord = VectorRecord> {
  private readonly records = new Map<string, T>();

  add(record: T): void {
    this.records.set(record.id, record);
  }

  remove(id: string): void {
    this.records.delete(id);
  }

  get(id: string): T | undefined {
    return this.records.get(id);
  }

  search(queryEmbedding: number[], topK: number = 5): SearchResult<T>[] {
    const results: SearchResult<T>[] = [];

    for (const record of this.records.values()) {
      const score = cosineSimilarity(queryEmbedding, record.embedding);
      if (Number.isNaN(score)) {
        continue;
      }
      results.push({ record, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  entries(): IterableIterator<T> {
    return this.records.values();
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
