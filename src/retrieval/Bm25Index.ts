interface DocumentStats {
  id: string;
  terms: Map<string, number>;
  length: number;
}

export interface Bm25Hit {
  id: string;
  score: number;
}

export class Bm25Index {
  private readonly documents = new Map<string, DocumentStats>();
  private readonly documentFrequency = new Map<string, number>();
  private totalDocumentLength = 0;

  constructor(private readonly k1 = 1.5, private readonly b = 0.75) {}

  addDocument(id: string, text: string): void {
    if (this.documents.has(id)) {
      this.removeDocument(id);
    }

    const tokens = this.tokenize(text);
    const terms = new Map<string, number>();
    for (const token of tokens) {
      terms.set(token, (terms.get(token) ?? 0) + 1);
    }

    for (const token of terms.keys()) {
      this.documentFrequency.set(token, (this.documentFrequency.get(token) ?? 0) + 1);
    }

    const stats: DocumentStats = {
      id,
      terms,
      length: tokens.length,
    };

    this.documents.set(id, stats);
    this.totalDocumentLength += stats.length;
  }

  removeDocument(id: string): void {
    const existing = this.documents.get(id);
    if (!existing) {
      return;
    }

    for (const token of existing.terms.keys()) {
      const count = this.documentFrequency.get(token);
      if (count === undefined) continue;
      if (count <= 1) {
        this.documentFrequency.delete(token);
      } else {
        this.documentFrequency.set(token, count - 1);
      }
    }

    this.documents.delete(id);
    this.totalDocumentLength -= existing.length;
  }

  search(query: string, topK: number): Bm25Hit[] {
    const tokens = this.tokenize(query);
    if (tokens.length === 0) {
      return [];
    }

    const docCount = this.documents.size;
    const averageDocLength = docCount > 0 ? this.totalDocumentLength / docCount : 0;
    const scores: Bm25Hit[] = [];

    for (const doc of this.documents.values()) {
      let score = 0;
      for (const token of tokens) {
        const tf = doc.terms.get(token);
        if (!tf) continue;
        const df = this.documentFrequency.get(token) ?? 0;
        const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (doc.length / (averageDocLength || 1)));
        score += idf * (numerator / denominator);
      }
      if (score > 0) {
        scores.push({ id: doc.id, score });
      }
    }

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  reset(): void {
    this.documents.clear();
    this.documentFrequency.clear();
    this.totalDocumentLength = 0;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9_]+/i)
      .filter(Boolean);
  }
}
