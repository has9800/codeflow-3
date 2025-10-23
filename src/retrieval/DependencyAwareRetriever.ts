import { CodeGraph, GraphNode } from '../graph/CodeGraph.js';
import { GraphWalker } from '../graph/GraphWalker.js';
import { QwenEmbedder } from '../embeddings/QwenEmbedder.js';
import { TextSearchEngine } from './TextSearchEngine.js';
import { TokenCounter } from './TokenCounter.js';

export interface DependencyContext {
  targetNodes: GraphNode[];
  forwardDeps: GraphNode[];
  backwardDeps: GraphNode[];
  relatedByQuery: GraphNode[];
  totalTokens: number;
  tokensUsed: number;
  formattedContext: string;
  tokensSaved: number;
  savingsPercent: number;
  searchType: 'dependency-aware';
  primaryFilePath: string;
  candidateFilePaths: string[];
}

interface ScoredNode {
  node: GraphNode;
  score: number;
}

interface Embedder {
  initialize(): Promise<void>;
  embed(text: string): Promise<number[]>;
}

class NoopEmbedder implements Embedder {
  async initialize(): Promise<void> {
    // Intentionally empty
  }

  async embed(_text: string): Promise<number[]> {
    return [];
  }
}

export class DependencyAwareRetriever {
  private walker: GraphWalker;
  private embedder: Embedder;
  private textSearch: TextSearchEngine;
  private tokenCounter: TokenCounter;
  private embeddingsEnabled = true;

  constructor(
    private graph: CodeGraph,
    deps?: {
      walker?: GraphWalker;
      embedder?: Embedder;
      textSearch?: TextSearchEngine;
      tokenCounter?: TokenCounter;
    }
  ) {
    this.walker = deps?.walker ?? new GraphWalker(graph);
    this.embedder = deps?.embedder ?? new QwenEmbedder();
    this.textSearch = deps?.textSearch ?? new TextSearchEngine();
    this.tokenCounter = deps?.tokenCounter ?? new TokenCounter();
  }

  async initialize(): Promise<void> {
    if (process.env.CODEFLOW_DISABLE_EMBEDDINGS === '1') {
      this.embedder = new NoopEmbedder();
      this.embeddingsEnabled = false;
      return;
    }

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

  /**
   * Build context for a code change by including all dependencies
   */
  async buildContextForChange(
    query: string,
    targetFilePath?: string,
    maxTokens: number = 6000,
    options?: { candidateFilePaths?: string[] }
  ): Promise<DependencyContext> {
    const inferredFile =
      targetFilePath ??
      options?.candidateFilePaths?.[0];

    if (!inferredFile) {
      throw new Error('Unable to determine target file for this request.');
    }

    const filePath = inferredFile;
    const candidatePaths = Array.from(
      new Set(
        options?.candidateFilePaths?.length
          ? options.candidateFilePaths
          : [filePath]
      )
    );
    
    // 1. Identify target nodes (what's being modified)
    const targetNodes = await this.identifyTargetNodes(query, filePath);
    
    // 2. Get forward dependencies (what target depends on)
    const forwardDeps = this.getForwardDependencies(targetNodes, 2);
    
    // 3. Get backward dependencies (who depends on target) - CRITICAL
    const backwardDeps = this.getBackwardDependencies(targetNodes, 2);
    
    // 4. Get semantic context from query
    const allExistingNodes = [
      ...targetNodes,
      ...forwardDeps,
      ...backwardDeps,
    ];
    const relatedByQuery = await this.getSemanticContext(
      query,
      allExistingNodes,
      5
    );
    
    // 5. Deduplicate and tag nodes with categories
    const deduped = this.deduplicateAndTag(
      targetNodes,
      forwardDeps,
      backwardDeps,
      relatedByQuery
    );
    
    // 6. Prioritize and build within token budget
    const finalContext = this.buildWithinBudget(
      deduped.target,
      deduped.forward,
      deduped.backward,
      deduped.related,
      maxTokens
    );
    
    // 7. Format context for model
    const formattedContext = this.formatContext(finalContext);
    const totalTokens = this.tokenCounter.count(formattedContext);
    
    // 8. Calculate savings
    const fullContextTokens = this.estimateFullContext(filePath);
    const tokensSaved = Math.max(0, fullContextTokens - totalTokens);
    const savingsPercent = fullContextTokens > 0
      ? (tokensSaved / fullContextTokens) * 100
      : 0;
    
    return {
      targetNodes: finalContext.target,
      forwardDeps: finalContext.forward,
      backwardDeps: finalContext.backward,
      relatedByQuery: finalContext.related,
      totalTokens,
      tokensUsed: totalTokens,
      formattedContext,
      tokensSaved,
      savingsPercent,
      searchType: 'dependency-aware',
      primaryFilePath: filePath,
      candidateFilePaths: candidatePaths,
    };
  }

  /**
   * Identify which specific nodes are being modified based on query
   */
  private async identifyTargetNodes(
    query: string,
    filePath: string
  ): Promise<GraphNode[]> {
    const fileNodes = this.graph.getNodesByPath(filePath);
    
    if (fileNodes.length === 0) {
      throw new Error(`No nodes found for file: ${filePath}`);
    }
    
    const queryLower = query.toLowerCase();
    
    // Extract mentioned identifiers from query
    const mentionedIdentifiers = this.extractIdentifiers(queryLower);
    
    // Score nodes based on query relevance
    const scored: ScoredNode[] = fileNodes
      .filter(node => node.type !== 'file') // Skip file nodes
      .map(node => ({
        node,
        score: this.scoreNodeRelevance(node, queryLower, mentionedIdentifiers),
      }))
      .filter(s => s.score > 1)
      .sort((a, b) => b.score - a.score);
    
    // Return top matches or all if none scored
    const targets = scored.length > 0
      ? scored.slice(0, 3).map(s => s.node)
      : fileNodes.filter(n => n.type === 'function' || n.type === 'class');
    
    return targets;
  }

  private extractIdentifiers(query: string): Set<string> {
    // Extract camelCase, snake_case, and PascalCase identifiers
    const matches = query.match(/[a-z_][a-z0-9_]*/gi) || [];
    return new Set(matches);
  }

  private scoreNodeRelevance(
    node: GraphNode,
    queryLower: string,
    identifiers: Set<string>
  ): number {
    let score = 0;
    const nameLower = node.name.toLowerCase();
    
    // Exact name match
    if (identifiers.has(nameLower)) {
      score += 10;
    }
    
    // Partial name match
    if (queryLower.includes(nameLower) || nameLower.includes(queryLower)) {
      score += 5;
    }
    
    // Type mention (e.g., "the function" when node is a function)
    if (queryLower.includes(node.type)) {
      score += 2;
    }
    
    // Action keywords
    const actions = ['fix', 'refactor', 'change', 'update', 'modify', 'add'];
    if (actions.some(action => queryLower.includes(action))) {
      score += 1;
    }
    
    return score;
  }

  /**
   * Get forward dependencies: what does this code import/call?
   */
  private getForwardDependencies(
    nodes: GraphNode[],
    maxDepth: number
  ): GraphNode[] {
    const allDeps: GraphNode[] = [];
    
    for (const node of nodes) {
      const deps = this.walker.bfs(node.id, maxDepth, [
        'imports',
        'calls',
        'references',
      ]);
      allDeps.push(...deps);
    }
    
    return allDeps;
  }

  /**
   * Get backward dependencies: who imports/calls this code?
   * CRITICAL for preventing breaking changes
   */
  private getBackwardDependencies(
    nodes: GraphNode[],
    maxDepth: number
  ): GraphNode[] {
    const allDependents: GraphNode[] = [];
    
    for (const node of nodes) {
      const dependents = this.walkBackward(node.id, maxDepth, [
        'imports',
        'calls',
        'references',
      ]);
      allDependents.push(...dependents);
    }
    
    return allDependents;
  }

  /**
   * Walk graph in reverse to find all dependents
   */
  private walkBackward(
    nodeId: string,
    maxDepth: number,
    edgeTypes: string[]
  ): GraphNode[] {
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; depth: number }> = [
      { nodeId, depth: 0 }
    ];
    const result: GraphNode[] = [];
    
    while (queue.length > 0) {
      const { nodeId: currentId, depth } = queue.shift()!;
      
      if (visited.has(currentId) || depth > maxDepth) {
        continue;
      }
      
      visited.add(currentId);
      const node = this.graph.getNode(currentId);
      if (node) result.push(node);
      
      if (depth < maxDepth) {
        // Find all edges pointing TO this node (reverse direction)
        const incomingEdges = this.graph
          .getAllEdges()
          .filter(edge => 
            edge.to === currentId && 
            edgeTypes.includes(edge.type)
          );
        
        for (const edge of incomingEdges) {
          if (!visited.has(edge.from)) {
            queue.push({ nodeId: edge.from, depth: depth + 1 });
          }
        }
      }
    }
    
    return result;
  }

  /**
   * Get additional semantic context using embeddings + text search
   */
  private async getSemanticContext(
    query: string,
    excludeNodes: GraphNode[],
    topK: number
  ): Promise<GraphNode[]> {
    if (!this.embeddingsEnabled) {
      return [];
    }

    const excludeIds = new Set(excludeNodes.map(n => n.id));
    const allNodes = this.graph
      .getAllNodes()
      .filter(n => !excludeIds.has(n.id) && n.type !== 'file');
    
    if (allNodes.length === 0) {
      return [];
    }
    
    // Try embedding search
    const queryEmbedding = await this.embedder.embed(query);
    const embeddingResults = await this.rankByEmbedding(
      allNodes,
      queryEmbedding,
      topK
    );

    let semanticNodes: GraphNode[] = embeddingResults.nodes;

    if (semanticNodes.length === 0) {
      const textResults = this.textSearch.search(query, allNodes, topK);
      semanticNodes = textResults.nodes;
    } else if (embeddingResults.scores[0] < 0.6) {
      const textResults = this.textSearch.search(query, allNodes, topK);
      semanticNodes = this.mergeSearchResults(
        embeddingResults.nodes,
        embeddingResults.scores,
        textResults.nodes,
        textResults.scores,
        topK
      );
    }

    const primaryLimit = Math.max(1, Math.ceil(topK * 0.6));
    const primary = semanticNodes.slice(0, primaryLimit);
    const expanded = this.expandGraphContext(primary, topK - primary.length);
    const merged = [...primary, ...expanded];

    const unique = new Map<string, GraphNode>();
    for (const node of merged) {
      if (!unique.has(node.id)) {
        unique.set(node.id, node);
      }
    }

    return Array.from(unique.values()).slice(0, topK);
  }

  private async rankByEmbedding(
    nodes: GraphNode[],
    queryEmbedding: number[],
    topK: number
  ): Promise<{ nodes: GraphNode[]; scores: number[] }> {
    if (!this.embeddingsEnabled) {
      return { nodes: [], scores: [] };
    }

    const scored: ScoredNode[] = [];
    
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
      scores: topResults.map(s => s.score),
    };
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

  private mergeSearchResults(
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
    
    // Add text results (weight: 0.4)
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

  private expandGraphContext(baseNodes: GraphNode[], maxAdditional: number): GraphNode[] {
    if (maxAdditional <= 0) {
      return [];
    }

    const additions: GraphNode[] = [];
    const visited = new Set<string>(baseNodes.map(node => node.id));

    const tryAdd = (candidate: GraphNode | undefined) => {
      if (!candidate) return;
      if (visited.has(candidate.id)) return;
      visited.add(candidate.id);
      additions.push(candidate);
    };

    for (const node of baseNodes) {
      if (additions.length >= maxAdditional) break;

      const siblings = this.graph
        .getNodesByPath(node.path)
        .filter(sibling => sibling.id !== node.id && (sibling.metadata as Record<string, unknown> | undefined)?.exported === true);
      for (const sibling of siblings) {
        tryAdd(sibling);
        if (additions.length >= maxAdditional) break;
      }

      const outgoing = this.graph.getOutgoingEdges(node.id);
      for (const edge of outgoing) {
        if (['calls', 'imports', 'references', 'contains'].includes(edge.type)) {
          const target = this.graph.getNode(edge.to);
          tryAdd(target);
        }
        if (additions.length >= maxAdditional) break;
      }

      const dependents = this.walkBackward(node.id, 1, ['calls', 'imports', 'references']);
      for (const dependent of dependents) {
        if (dependent.id === node.id) continue;
        tryAdd(dependent);
        if (additions.length >= maxAdditional) break;
      }
    }

    return additions.slice(0, maxAdditional);
  }

  /**
   * Deduplicate nodes and tag with categories
   */
  private deduplicateAndTag(
    target: GraphNode[],
    forward: GraphNode[],
    backward: GraphNode[],
    related: GraphNode[]
  ): {
    target: GraphNode[];
    forward: GraphNode[];
    backward: GraphNode[];
    related: GraphNode[];
  } {
    const targetIds = new Set(target.map(n => n.id));
    const forwardIds = new Set(forward.map(n => n.id));
    const backwardIds = new Set(backward.map(n => n.id));
    
    // Tag nodes with their categories
    target.forEach(n => n.metadata.category = 'target');
    
    // Remove overlaps from forward deps
    const cleanForward = forward.filter(n => {
      if (targetIds.has(n.id)) return false;
      n.metadata.category = 'forward';
      return true;
    });
    
    // Remove overlaps from backward deps
    const cleanBackward = backward.filter(n => {
      if (targetIds.has(n.id) || forwardIds.has(n.id)) return false;
      n.metadata.category = 'backward';
      return true;
    });
    
    // Remove overlaps from related
    const relatedSet = new Map<string, GraphNode>();
    const cleanRelated = related.filter(n => {
      if (targetIds.has(n.id) || forwardIds.has(n.id) || backwardIds.has(n.id)) {
        return false;
      }
      n.metadata.category = 'related';
      relatedSet.set(n.id, n);
      return true;
    });

    for (const node of target) {
      const siblings = this.graph
        .getNodesByPath(node.path)
        .filter(sibling => {
          if (sibling.id === node.id) return false;
          if (targetIds.has(sibling.id) || forwardIds.has(sibling.id) || backwardIds.has(sibling.id)) {
            return false;
          }
          return sibling.type !== 'file';
        });

      for (const sibling of siblings) {
        if (!relatedSet.has(sibling.id)) {
          sibling.metadata.category = 'related';
          relatedSet.set(sibling.id, sibling);
          cleanRelated.push(sibling);
        }
      }
    }

    return {
      target,
      forward: cleanForward,
      backward: cleanBackward,
      related: cleanRelated,
    };
  }

  /**
   * Build context within token budget with priority ordering
   */
  private buildWithinBudget(
    target: GraphNode[],
    forward: GraphNode[],
    backward: GraphNode[],
    related: GraphNode[],
    maxTokens: number
  ): {
    target: GraphNode[];
    forward: GraphNode[];
    backward: GraphNode[];
    related: GraphNode[];
  } {
    const result = {
      target: [...target],
      forward: [] as GraphNode[],
      backward: [] as GraphNode[],
      related: [] as GraphNode[],
    };
    
    // Always include all target nodes
    let currentTokens = this.estimateTokens(target);
    
    // Priority 1: Backward deps (critical - prevents breaking changes)
    for (const node of backward) {
      const nodeTokens = this.estimateTokens([node]);
      if (currentTokens + nodeTokens <= maxTokens * 0.8) { // Reserve 20% for forward/related
        result.backward.push(node);
        currentTokens += nodeTokens;
      }
    }
    
    // Priority 2: Forward deps (important - maintains functionality)
    for (const node of forward) {
      const nodeTokens = this.estimateTokens([node]);
      if (currentTokens + nodeTokens <= maxTokens * 0.95) { // Reserve 5% for related
        result.forward.push(node);
        currentTokens += nodeTokens;
      }
    }
    
    // Priority 3: Related context (nice-to-have)
    for (const node of related) {
      const nodeTokens = this.estimateTokens([node]);
      if (currentTokens + nodeTokens <= maxTokens) {
        result.related.push(node);
        currentTokens += nodeTokens;
      }
    }
    
    return result;
  }

  /**
   * Format context for the model with clear sections
   */
  private formatContext(context: {
    target: GraphNode[];
    forward: GraphNode[];
    backward: GraphNode[];
    related: GraphNode[];
  }): string {
    const sections: string[] = [];
    
    if (context.target.length > 0) {
      sections.push('# TARGET CODE (being modified)\n');
      sections.push(context.target.map(this.formatNode).join('\n\n'));
    }
    
    if (context.backward.length > 0) {
      sections.push('\n# DEPENDENTS (code that calls/imports the target - MUST update if signature changes)\n');
      sections.push(context.backward.map(this.formatNode).join('\n\n'));
    }
    
    if (context.forward.length > 0) {
      sections.push('\n# DEPENDENCIES (code that target calls/imports)\n');
      sections.push(context.forward.map(this.formatNode).join('\n\n'));
    }
    
    if (context.related.length > 0) {
      sections.push('\n# RELATED CONTEXT (similar or relevant code)\n');
      sections.push(context.related.map(this.formatNode).join('\n\n'));
    }
    
    return sections.join('\n');
  }

  private formatNode(node: GraphNode): string {
    return `## ${node.type}: ${node.name}
File: ${node.path}
Lines: ${node.startLine}-${node.endLine}

\`\`\`
${node.content}
\`\`\``;
  }

  private estimateTokens(nodes: GraphNode[]): number {
    const content = nodes.map(n => this.formatNode(n)).join('\n\n');
    return this.tokenCounter.count(content);
  }

  private estimateFullContext(filePath: string): number {
    const nodes = this.graph.getNodesByPath(filePath);
    const content = nodes.map(n => n.content).join('\n');
    return this.tokenCounter.count(content) * 3; // Multiply by 3 for typical full-context overhead
  }
}
