import { CodeGraph, GraphNode } from '../graph/CodeGraph.js';
import { GraphWalker } from '../graph/GraphWalker.js';
import { QwenEmbedder } from '../embeddings/QwenEmbedder.js';
import { ConfidenceAnalyzer, ConfidenceScore } from './ConfidenceAnalyzer.js';
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
  confidence?: ConfidenceScore;
}

export class AdaptiveRetriever {
  private walker: GraphWalker;
  private embedder: QwenEmbedder;
  private confidenceAnalyzer: ConfidenceAnalyzer;
  private contextBuilder: ContextBuilder;
  private tokenCounter: TokenCounter;

  constructor(
    private graph: CodeGraph,
    private tiers: RetrievalTier[] = DEFAULT_TIERS
  ) {
    this.walker = new GraphWalker(graph);
    this.embedder = new QwenEmbedder();
    this.confidenceAnalyzer = new ConfidenceAnalyzer();
    this.contextBuilder = new ContextBuilder();
    this.tokenCounter = new TokenCounter();
  }

  async retrieve(
    query: string,
    activeFilePath: string,
    startTier: number = 0
  ): Promise<RetrievalResult> {
    const tier = this.tiers[Math.min(startTier, this.tiers.length - 1)];
    
    // Get active file node
    const fileNodes = this.graph.getNodesByPath(activeFilePath);
    if (fileNodes.length === 0) {
      throw new Error(`No nodes found for file: ${activeFilePath}`);
    }
    
    // Walk graph from active file
    const reachableNodes = this.walker.bfs(
      fileNodes[0].id,
      tier.graphDepth,
      ['imports', 'calls', 'references']
    );
    
    // Embed query and rank nodes
    const queryEmbedding = await this.embedder.embed(query);
    const rankedNodes = await this.rankNodes(reachableNodes, queryEmbedding, tier.topK);
    
    // Build context
    const context = this.contextBuilder.build(rankedNodes, tier.maxTokens);
    const tokensUsed = this.tokenCounter.count(context);
    
    // Calculate savings vs full context
    const fullContextTokens = this.estimateFullContext(activeFilePath);
    const tokensSaved = fullContextTokens - tokensUsed;
    const savingsPercent = (tokensSaved / fullContextTokens) * 100;
    
    return {
      context,
      nodes: rankedNodes,
      tier: startTier,
      tierName: tier.name,
      tokensUsed,
      tokensSaved,
      savingsPercent,
    };
  }

  // combined retrieval strategy
//   async retrieve(query: string, filePath: string): Promise<Context> {
//   // 1. Start with graph-aware dependency retrieval
//   const depContext = await this.buildContextForChange(query, filePath, 4000);
  
//   // 2. Check if model has enough context (confidence)
//   const response = await this.callModel(depContext);
//   const confidence = this.analyzeConfidence(response);
  
//   // 3. If low confidence, ADD semantic search results
//   if (confidence.score < 0.7) {
//     const semanticNodes = await this.getSemanticContext(query, depContext.allNodes, 5);
//     depContext.relatedByQuery.push(...semanticNodes);
//   }
  
//   // 4. If still uncertain, expand graph walk depth
//   if (confidence.score < 0.5) {
//     const deeper = this.getBackwardDependencies(depContext.targetNodes, 3); // depth 3
//     depContext.backwardDeps.push(...deeper);
//   }
  
//   return depContext;
// }

  async retrieveWithExpansion(
    query: string,
    activeFilePath: string,
    maxAttempts: number = 3
  ): Promise<RetrievalResult> {
    let tier = 0;
    let lastResult: RetrievalResult | null = null;
    
    while (tier < this.tiers.length && tier < maxAttempts) {
      const result = await this.retrieve(query, activeFilePath, tier);
      lastResult = result;
      
      // Check if we should expand (would need model response for real check)
      // For now, return first result
      return result;
    }
    
    return lastResult!;
  }

  private async rankNodes(
    nodes: GraphNode[],
    queryEmbedding: number[],
    topK: number
  ): Promise<GraphNode[]> {
    const scored: Array<{ node: GraphNode; score: number }> = [];
    
    for (const node of nodes) {
      if (!node.embedding) {
        // Embed node content if not already embedded
        node.embedding = await this.embedder.embed(node.content);
      }
      
      const score = this.cosineSimilarity(queryEmbedding, node.embedding);
      scored.push({ node, score });
    }
    
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(s => s.node);
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
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private estimateFullContext(filePath: string): number {
    const nodes = this.graph.getNodesByPath(filePath);
    const content = nodes.map(n => n.content).join('\n');
    return this.tokenCounter.count(content);
  }
}
