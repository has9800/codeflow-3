import { CodeGraph, GraphNode } from '../graph/CodeGraph.js';
import { TextSearchEngine } from './TextSearchEngine.js';

interface CandidateScore {
  node: GraphNode;
  score: number;
  reasons: string[];
}

export interface TargetCandidate {
  path: string;
  score: number;
  nodes: GraphNode[];
  reasons: string[];
}

export interface TargetResolution {
  primary?: TargetCandidate;
  candidates: TargetCandidate[];
}

export interface TargetResolverOptions {
  recentPaths?: string[];
  limit?: number;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export class TargetResolver {
  private textSearch: TextSearchEngine;

  constructor(
    private graph: CodeGraph,
    private embedder: EmbeddingProvider,
    textSearch?: TextSearchEngine
  ) {
    this.textSearch = textSearch ?? new TextSearchEngine();
  }

  async resolve(
    query: string,
    options?: TargetResolverOptions
  ): Promise<TargetResolution> {
    const limit = options?.limit ?? 3;
    const candidates = new Map<string, CandidateScore>();

    const allNodes = this.graph.getAllNodes();
    const symbolNodes = allNodes.filter(node => node.type !== 'file');

    if (symbolNodes.length === 0) {
      return { candidates: [] };
    }

    const identifiers = this.extractIdentifiers(query);
    const queryLower = query.toLowerCase();

    // Identifier / name matches
    for (const node of symbolNodes) {
      const nameLower = node.name.toLowerCase();
      const entry = this.ensureCandidate(candidates, node);

      if (identifiers.has(nameLower)) {
        entry.score += 8;
        this.addReason(entry, `Identifier match: ${node.name}`);
      } else if (queryLower.includes(nameLower)) {
        entry.score += 4;
        this.addReason(entry, `Name mentioned: ${node.name}`);
      }
    }

    // Text search scoring (BM25)
    const textResults = this.textSearch.search(query, symbolNodes, 25);
    textResults.nodes.forEach((node, idx) => {
      const score = textResults.scores[idx];
      if (score <= 0) {
        return;
      }

      const entry = this.ensureCandidate(candidates, node);
      entry.score += score * 6;
      this.addReason(entry, `Text similarity score ${score.toFixed(2)}`);
    });

    // Embedding similarity for top textual matches
    const embeddingTargets = Array.from(
      new Set(
        textResults.nodes
          .slice(0, 20)
          .concat(
            Array.from(candidates.values())
              .sort((a, b) => b.score - a.score)
              .slice(0, 20)
              .map(entry => entry.node)
          )
      )
    );

    if (embeddingTargets.length > 0) {
      const queryEmbedding = await this.embedder.embed(query);

      for (const node of embeddingTargets) {
        if (!node.embedding) {
          node.embedding = await this.embedder.embed(node.content);
        }

        const similarity = this.cosineSimilarity(queryEmbedding, node.embedding);
        if (similarity <= 0) continue;

      const entry = this.ensureCandidate(candidates, node);
      entry.score += similarity * 10;
      this.addReason(entry, `Semantic similarity ${similarity.toFixed(2)}`);
    }
  }

    // Recent file boost
    if (options?.recentPaths?.length) {
      for (const entry of candidates.values()) {
        if (options.recentPaths.includes(entry.node.path)) {
          entry.score += 2;
          this.addReason(entry, 'Recent file preference');
        }
      }
    }

    // Aggregate by file path
    const fileScores = new Map<string, TargetCandidate>();
    for (const entry of candidates.values()) {
      const existing = fileScores.get(entry.node.path);
      if (existing) {
        existing.score += entry.score;
        existing.nodes.push(entry.node);
        existing.reasons.push(...entry.reasons);
      } else {
        fileScores.set(entry.node.path, {
          path: entry.node.path,
          score: entry.score,
          nodes: [entry.node],
          reasons: [...entry.reasons],
        });
      }
    }

    // Fallback: search file nodes directly if we still have nothing
    if (fileScores.size === 0) {
      const fileNodes = allNodes.filter(node => node.type === 'file');
      const fileResults = this.textSearch.search(query, fileNodes, limit);

      fileResults.nodes.forEach((node, idx) => {
        const score = fileResults.scores[idx];
        if (score <= 0) return;

       fileScores.set(node.path, {
         path: node.path,
         score,
         nodes: [node],
         reasons: [`File text similarity ${score.toFixed(2)}`],
       });
      });
    }

    const ranked = Array.from(fileScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(candidate => ({
        ...candidate,
        reasons: Array.from(new Set(candidate.reasons)).slice(0, 5),
      }));

    return {
      primary: ranked[0],
      candidates: ranked,
    };
  }

  private ensureCandidate(
    map: Map<string, CandidateScore>,
    node: GraphNode
  ): CandidateScore {
    let entry = map.get(node.id);
    if (!entry) {
      entry = { node, score: 0, reasons: [] };
      map.set(node.id, entry);
    }
    return entry;
  }

  private addReason(entry: CandidateScore, reason: string): void {
    if (!entry.reasons.includes(reason)) {
      entry.reasons.push(reason);
    }
  }

  private extractIdentifiers(query: string): Set<string> {
    const matches = query.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
    return new Set(matches.map(match => match.toLowerCase()));
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}

