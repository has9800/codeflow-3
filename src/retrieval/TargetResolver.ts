import { CodeGraph, type GraphNode } from '../graph/CodeGraph.js';
import { logger } from '../utils/logger.js';
import { HnswAnnIndex, type AnnResult } from './AnnIndex.js';
import { Bm25Index, type Bm25Hit } from './Bm25Index.js';
import { reciprocalRankFusion, type CandidateSource } from './CandidateFusion.js';
import { HybridReranker, type RerankResult } from './HybridReranker.js';
import type { CrossEncoder } from './CrossEncoder.js';
import { TransformersCrossEncoder } from './CrossEncoder.js';

type FusedSeed = ReturnType<typeof reciprocalRankFusion>[number];

export type CandidateSourceScores = Partial<Record<CandidateSource, number>>;

export interface CandidateScoreBreakdown {
  fused: number;
  semantic: number;
  lexical: number;
  structural: number;
  cross?: number;
}

export interface TargetCandidate {
  path: string;
  score: number;
  nodes: GraphNode[];
  reasons: string[];
  sourceScores: CandidateSourceScores;
  scoreBreakdown: CandidateScoreBreakdown;
}

export interface TargetResolution {
  primary?: TargetCandidate;
  candidates: TargetCandidate[];
}

export interface TargetResolverOptions {
  recentPaths?: string[];
  limit?: number;
  seedCount?: number;
}

export interface TargetResolverConfig {
  reranker?: HybridReranker;
  crossEncoder?: CrossEncoder;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export class TargetResolver {
  private readonly annIndex = new HnswAnnIndex();
  private readonly bm25Index = new Bm25Index();
  private readonly nodeIndex = new Map<string, GraphNode>();
  private readonly crossEncoder?: CrossEncoder;
  private readonly reranker: HybridReranker;

  constructor(
    private readonly graph: CodeGraph,
    private readonly embedder: EmbeddingProvider,
    config: TargetResolverConfig = {}
  ) {
    this.crossEncoder = config.crossEncoder ?? this.initCrossEncoder();
    this.reranker = config.reranker ?? new HybridReranker({ crossEncoder: this.crossEncoder });
    this.buildIndexes();
  }

  async resolve(
    query: string,
    options?: TargetResolverOptions
  ): Promise<TargetResolution> {
    const limit = options?.limit ?? 3;
    const seedCount = Math.max(options?.seedCount ?? limit * 3, limit);

    const annResults = await this.searchAnn(query, seedCount);
    const lexicalResults = this.searchBm25(query, seedCount);

    if (annResults.length === 0 && lexicalResults.length === 0) {
      return { candidates: [] };
    }

    const fusedSeeds = reciprocalRankFusion(annResults, lexicalResults, seedCount);
    const fusedMap = new Map(fusedSeeds.map(seed => [seed.id, seed]));

    const rerankInputs = fusedSeeds
      .map(seed => ({ candidate: seed, node: this.nodeIndex.get(seed.id) }))
      .filter(
        (entry): entry is { candidate: (typeof fusedSeeds)[number]; node: GraphNode } =>
          Boolean(entry.node)
      );

    if (rerankInputs.length === 0) {
      return { candidates: [] };
    }

    const reranked = await this.reranker.rerank(query, rerankInputs, seedCount);
    const grouped = this.groupByPath(reranked, fusedMap);
    this.applyRecentBoost(grouped, options?.recentPaths ?? []);

    grouped.sort((a, b) => b.score - a.score);
    const final = grouped
      .map(candidate => ({
        ...candidate,
        reasons: Array.from(new Set(candidate.reasons)).slice(0, 6),
      }))
      .slice(0, limit);

    return {
      primary: final[0],
      candidates: final,
    };
  }

  private initCrossEncoder(): CrossEncoder | undefined {
    const enableFlag = process.env.CODEFLOW_ENABLE_CROSS_ENCODER === '1';
    const modelId = process.env.CODEFLOW_CROSS_ENCODER_MODEL;

    if (!enableFlag && !modelId) {
      return undefined;
    }

    try {
      return new TransformersCrossEncoder({
        model: modelId,
        cacheDir: process.env.CODEFLOW_MODEL_CACHE,
      });
    } catch (error) {
      logger.warn(
        'Failed to initialise cross-encoder',
        error instanceof Error ? error.message : String(error)
      );
      return undefined;
    }
  }

  private buildIndexes(): void {
    for (const node of this.graph.getAllNodes()) {
      this.nodeIndex.set(node.id, node);

      if (node.embedding && node.embedding.length > 0) {
        try {
          this.annIndex.add(node.id, node.embedding);
        } catch {
          // Ignore vectors that fail validation; ANN search will fall back to lexical results.
        }
      }

      const lexicalContent = this.getLexicalContent(node);
      if (lexicalContent) {
        this.bm25Index.addDocument(node.id, lexicalContent);
      }
    }
  }

  private getLexicalContent(node: GraphNode): string | undefined {
    const fromMetadata = node.metadata?.embeddingText as unknown;
    if (typeof fromMetadata === 'string') {
      const trimmed = fromMetadata.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    const fallback = node.content.trim();
    return fallback.length > 0 ? fallback : undefined;
  }

  private async searchAnn(query: string, topK: number): Promise<AnnResult[]> {
    const stats = this.annIndex.stats();
    if (stats.vectors === 0) {
      return [];
    }

    try {
      const embedding = await this.embedder.embed(query);
      if (stats.dimension > 0 && embedding.length !== stats.dimension) {
        return [];
      }
      return this.annIndex.search(embedding, topK);
    } catch {
      return [];
    }
  }

  private searchBm25(query: string, topK: number): Bm25Hit[] {
    return this.bm25Index.search(query, topK);
  }

  private groupByPath(
    reranked: RerankResult[],
    fusedMap: Map<string, FusedSeed>
  ): TargetCandidate[] {
    const grouped = new Map<string, TargetCandidate>();

    for (const result of reranked) {
      const node = this.nodeIndex.get(result.id);
      if (!node) continue;
      const fused = fusedMap.get(result.id);

      const entry = grouped.get(node.path) ?? this.createCandidate(node.path);

      entry.score += result.score;
      entry.nodes.push(node);
      entry.reasons.push(...this.describeSignal(node, result, fused));
      entry.scoreBreakdown.fused += fused?.fusedScore ?? 0;
      entry.scoreBreakdown.semantic += result.semanticScore;
      entry.scoreBreakdown.lexical += result.lexicalScore;
      entry.scoreBreakdown.structural += result.structuralScore;
      if (this.crossEncoder && entry.scoreBreakdown.cross !== undefined) {
        entry.scoreBreakdown.cross += result.crossScore ?? 0;
      }

      if (fused) {
        for (const [source, value] of fused.sources.entries()) {
          entry.sourceScores[source] = (entry.sourceScores[source] ?? 0) + value;
        }
      }

      grouped.set(node.path, entry);
    }

    return Array.from(grouped.values());
  }

  private createCandidate(path: string): TargetCandidate {
    const breakdown: CandidateScoreBreakdown = {
      fused: 0,
      semantic: 0,
      lexical: 0,
      structural: 0,
    };

    if (this.crossEncoder) {
      breakdown.cross = 0;
    }

    return {
      path,
      score: 0,
      nodes: [],
      reasons: [],
      sourceScores: {},
      scoreBreakdown: breakdown,
    };
  }

  private describeSignal(
    node: GraphNode,
    scores: RerankResult,
    fused: FusedSeed | undefined
  ): string[] {
    const reasons: string[] = [];

    if (fused) {
      const annSeed = fused.sources.get('ANN');
      const bm25Seed = fused.sources.get('BM25');
      if (annSeed !== undefined) {
        reasons.push(`Semantic seed ${annSeed.toFixed(2)}`);
      }
      if (bm25Seed !== undefined) {
        reasons.push(`Lexical seed ${bm25Seed.toFixed(2)}`);
      }
      reasons.push(`Fused seed ${fused.fusedScore.toFixed(2)}`);
    }

    reasons.push(`Semantic rerank ${scores.semanticScore.toFixed(2)}`);
    reasons.push(`Lexical rerank ${scores.lexicalScore.toFixed(2)}`);
    reasons.push(`Structural signal ${scores.structuralScore.toFixed(2)}`);
    if (scores.crossScore !== undefined) {
      reasons.push(`Cross rerank ${scores.crossScore.toFixed(2)}`);
    }
    reasons.push(`Candidate ${node.type} ${node.name}`);

    return reasons;
  }

  private applyRecentBoost(
    candidates: TargetCandidate[],
    recentPaths: string[]
  ): void {
    if (recentPaths.length === 0) {
      return;
    }

    const recent = new Set(recentPaths);
    for (const candidate of candidates) {
      if (recent.has(candidate.path)) {
        candidate.score += 1;
        candidate.reasons.push('Recent focus boost');
      }
    }
  }
}

