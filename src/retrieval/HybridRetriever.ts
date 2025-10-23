import { CodeGraph, GraphNode } from '../graph/CodeGraph.js';
import { GraphWalker } from '../graph/GraphWalker.js';
import { QwenEmbedder } from '../embeddings/QwenEmbedder.js';
import { TextSearchEngine } from './TextSearchEngine.js';
import { ContextBuilder } from './ContextBuilder.js';
import { TokenCounter } from './TokenCounter.js';

export interface RetrievalTier {
  name: string;
  graphDepth: number;
  topK: number;
  maxTokens: number;
}

export const DEFAULT_TIERS: RetrievalTier[] = [
  { name: 'lean', graphDepth: 1, topK: 3, maxTokens: 1500 },
  { name: 'expanded', graphDepth: 2, topK: 5, maxTokens: 3000 },
  { name: 'deep', graphDepth: 3, topK: 10, maxTokens: 6000 },
  { name: 'full', graphDepth: 99, topK: 50, maxTokens: 15000 }
];

export interface RetrievalResult {
  context: string;
  nodes: GraphNode[];
  tier: number;
  tierName: string;
  tokensUsed: number;
  tokensSaved: number;
  savingsPercent: number;
  searchType: 'embedding' | 'text' | 'hybrid';
  topScore: number;
}

const SIMILARITY_THRESHOLD = 0.6; // Below this, fallback to text search

export class HybridRetriever {
  private walker: GraphWalker;
  private embedder: QwenEmbedder;
  private textSearch: TextSearchEngine;
  private contextBuilder: ContextBuilder;
  private tokenCounter: TokenCounter;

  constructor(
    private graph: CodeGraph,
    private tiers: RetrievalTier[] = DEFAULT_TIERS
  ) {
    this.walker = new GraphWalker(graph);
    this.embedder = new QwenEmbedder();
    this.textSearch = new TextSearchEngine();
    this.contextBuilder = new ContextBuilder();
    this.tokenCounter = new TokenCounter();
  }

  async retrieve(
    query: string,
    activeFilePath: string,
    startTier: number = 0
  ): Promise<RetrievalResult> {
    const tier = this.tiers[Math.min(startTier, this.tiers.length - 1)];

    // Get active file nodes
    const fileNodes = this.graph.getNodesByPath(activeFilePath);
    if (fileNodes.length === 0) {
      throw new Error(`No nodes found for file: ${activeFilePath}`);
    }

    // Walk graph from active file
    const reachableNodes = this.walker.bfs(
      fileNodes[0].id,
      tier.graphDepth,
      ['imports', 'calls', 'references', 'contains']
    );

    // Try embedding search first
    const queryEmbedding = await this.embedder.embed(query);
    const embeddingResults = await this.rankByEmbedding(
      reachableNodes,
      queryEmbedding,
      tier.topK
    );

    let finalNodes: GraphNode[];
    let searchType: 'embedding' | 'text' | 'hybrid';
    let topScore: number;

    // Check if embedding results are good enough
    if (embeddingResults.scores[0] >= SIMILARITY_THRESHOLD) {
      // Good semantic match, use embedding results
      finalNodes = embeddingResults.nodes;
      searchType = 'embedding';
      topScore = embeddingResults.scores[0];
    } else {
      // Low semantic similarity, try text search
      const textResults = this.textSearch.search(query, reachableNodes, tier.topK);

      if (textResults.scores[0] > embeddingResults.scores[0] * 0.8) {
        // Text search found better matches, use hybrid
        finalNodes = this.mergeResults(
          embeddingResults.nodes,
          embeddingResults.scores,
          textResults.nodes,
          textResults.scores,
          tier.topK
        );
        searchType = 'hybrid';
        topScore = Math.max(textResults.scores[0], embeddingResults.scores[0]);
      } else {
        // Embedding still better, but low confidence
        finalNodes = embeddingResults.nodes;
        searchType = 'embedding';
        topScore = embeddingResults.scores[0];
      }
    }

    // Build context
    const context = this.contextBuilder.build(finalNodes, tier.maxTokens);
    const tokensUsed = this.tokenCounter.count(context);

    // Calculate savings
    const fullContextTokens = this.estimateFullContext(activeFilePath);
    const tokensSaved = Math.max(0, fullContextTokens - tokensUsed);
    const savingsPercent = fullContextTokens > 0
      ? (tokensSaved / fullContextTokens) * 100
      : 0;

    return {
      context,
      nodes: finalNodes,
      tier: startTier,
      tierName: tier.name,
      tokensUsed,
      tokensSaved,
      savingsPercent,
      searchType,
      topScore,
    };
  }

  private async rankByEmbedding(
    nodes: GraphNode[],
    queryEmbedding: number[],
    topK: number
  ): Promise<{ nodes: GraphNode[]; scores: number[] }> {
    const scored: Array<{ node: GraphNode; score: number }> = [];

    for (const node of nodes) {
      if (!node.embedding) {
        node.embedding = await this.embedder.embed(node.content);
      }

      const score = this.cosineSimilarity(queryEmbedding, node.embedding);
      scored.push({ node, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, topK);

    return {
      nodes: topResults.map(s => s.node),
      scores: topResults.map(s => s.score)
    };
  }

  private mergeResults(
    embeddingNodes: GraphNode[],
    embeddingScores: number[],
    textNodes: GraphNode[],
    textScores: number[],
    topK: number
  ): GraphNode[] {
    const nodeScores = new Map<string, number>();
    const allNodes = new Map<string, GraphNode>();

    // Add embedding results (weight: 0.6)
    embeddingNodes.forEach((node, i) => {
      const score = embeddingScores[i] * 0.6;
      nodeScores.set(node.id, score);
      allNodes.set(node.id, node);
    });

    // Add text results (weight: 0.4), merge scores if overlap
    textNodes.forEach((node, i) => {
      const score = textScores[i] * 0.4;
      const existing = nodeScores.get(node.id) || 0;
      nodeScores.set(node.id, existing + score);
      allNodes.set(node.id, node);
    });

    // Sort by combined score
    const sorted = Array.from(nodeScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    return sorted.map(([id]) => allNodes.get(id)!);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dotProduct / denom;
  }

  private estimateFullContext(filePath: string): number {
    const nodes = this.graph.getNodesByPath(filePath);
    const content = nodes.map(n => n.content).join('\n');
    return this.tokenCounter.count(content);
  }
}
