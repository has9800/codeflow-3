import { CodeGraph, GraphNode } from '../graph/CodeGraph.js';
import { GraphWalker } from '../graph/GraphWalker.js';
import { QwenEmbedder } from '../embeddings/QwenEmbedder.js';
import { TextSearchEngine } from './TextSearchEngine.js';
import { TokenCounter } from './TokenCounter.js';
import { TargetResolver } from './TargetResolver.js';
import type { CandidateSourceScores, TargetCandidate } from './TargetResolver.js';

export interface ContextTelemetry {
  targetResolution: {
    primaryPath?: string;
    candidateCount: number;
    sourceScores: CandidateSourceScores;
    aggregateSourceScores: CandidateSourceScores;
  };
  tokens: {
    budget: number;
    used: number;
    saved: number;
    savingsPercent: number;
  };
}

export interface BuildContextOptions {
  candidateFilePaths?: string[];
  walkDepth?: number;
  relatedLimit?: number;
  breadthLimit?: number;
}


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
  telemetry: ContextTelemetry;
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
  private targetResolver: TargetResolver;

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
    this.targetResolver = new TargetResolver(graph, this.embedder);
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

    this.targetResolver = new TargetResolver(this.graph, this.embedder);
  }

  /**
   * Build context for a code change by including all dependencies
   */
  async buildContextForChange(
    query: string,
    targetFilePath?: string,
    maxTokens: number = 6000,
    options?: BuildContextOptions
  ): Promise<DependencyContext> {
    const tokenBudget = this.clampTokenBudget(maxTokens);
    const fallbackPaths = [
      ...(options?.candidateFilePaths ?? []),
      ...(targetFilePath ? [targetFilePath] : []),
    ].filter((path): path is string => Boolean(path));

    const walkDepth = options?.walkDepth ?? 2;
    const relatedLimit = options?.relatedLimit ?? 5;
    const breadthLimit = options?.breadthLimit ?? 3;

    const resolution = await this.targetResolver.resolve(query, {
      recentPaths: fallbackPaths,
      limit: 5,
    });

    const primaryFilePath = resolution.primary?.path ?? fallbackPaths[0];

    if (!primaryFilePath) {
      throw new Error('Unable to determine target file for this request.');
    }

    const candidatePaths = Array.from(
      new Set([
        primaryFilePath,
        ...fallbackPaths,
        ...resolution.candidates.map(candidate => candidate.path),
      ])
    );
    
    // 1. Identify target nodes (what's being modified)
    let targetNodes: GraphNode[] = [];
    if (resolution.primary?.nodes?.length) {
      targetNodes = resolution.primary.nodes
        .map(node => this.graph.getNode(node.id))
        .filter((node): node is GraphNode => Boolean(node));
    }

    if (targetNodes.length === 0) {
      targetNodes = await this.identifyTargetNodes(query, primaryFilePath);
    }

    if (targetNodes.length === 0) {
      const fileNodes = this.graph.getNodesByPath(primaryFilePath);
      targetNodes = fileNodes.filter(node => node.type !== 'file');
      if (targetNodes.length === 0 && fileNodes.length > 0) {
        targetNodes = [fileNodes[0]];
      }
    }

    // 2. Get forward dependencies (what target depends on)
    const forwardDeps = this.getForwardDependencies(targetNodes, walkDepth, breadthLimit);

    // 3. Get backward dependencies (who depends on target)
    const backwardDeps = this.getBackwardDependencies(targetNodes, walkDepth, breadthLimit);

    // 4. Get semantic context from query and seeded candidates
    const allExistingNodes = [
      ...targetNodes,
      ...forwardDeps,
      ...backwardDeps,
    ];
    const semanticRelated = await this.getSemanticContext(
      query,
      allExistingNodes,
      relatedLimit
    );
    const seededRelated = resolution.candidates
      .slice(1)
      .flatMap(candidate => candidate.nodes)
      .map(node => this.graph.getNode(node.id))
      .filter((node): node is GraphNode => Boolean(node));
    const relatedByQuery = [...semanticRelated, ...seededRelated];
    
    // 5. Deduplicate and tag nodes with categories
    const deduped = this.deduplicateAndTag(
      targetNodes,
      forwardDeps,
      backwardDeps,
      relatedByQuery,
      breadthLimit
    );
    
    // 6. Prioritize and build within token budget
    const finalContext = this.buildWithinBudget(
      deduped.target,
      deduped.forward,
      deduped.backward,
      deduped.related,
      tokenBudget
    );
    
    // 7. Format context for model
    const formattedContext = this.formatContext(finalContext);
    const totalTokens = this.tokenCounter.count(formattedContext);
    
    // 8. Calculate savings
    const fullContextTokens = this.estimateFullContext(primaryFilePath);
    const tokensSaved = Math.max(0, fullContextTokens - totalTokens);
    const savingsPercent = fullContextTokens > 0
      ? (tokensSaved / fullContextTokens) * 100
      : 0;

    const telemetry: ContextTelemetry = {
      targetResolution: {
        primaryPath: resolution.primary?.path,
        candidateCount: resolution.candidates.length,
        sourceScores: resolution.primary?.sourceScores ?? {},
        aggregateSourceScores: this.combineSourceScores(resolution.candidates),
      },
      tokens: {
        budget: tokenBudget,
        used: totalTokens,
        saved: tokensSaved,
        savingsPercent,
      },
    };
    
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
      primaryFilePath: primaryFilePath,
      candidateFilePaths: candidatePaths,
      telemetry,
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
    maxDepth: number,
    breadthLimit: number
  ): GraphNode[] {
    const allDeps: GraphNode[] = [];
    
    for (const node of nodes) {
      const deps = this.walker.bfs(node.id, maxDepth, [
        'imports',
        'calls',
        'references',
      ]);
      allDeps.push(
        ...deps.filter(dep => dep.id !== node.id && dep.type !== 'file')
      );
    }

    const unique = this.dedupeNodes(allDeps);
    return this.limitByBreadth(unique, Math.max(1, breadthLimit));
  }

  /**
   * Get backward dependencies: who imports/calls this code?
   * CRITICAL for preventing breaking changes
   */
  private getBackwardDependencies(
    nodes: GraphNode[],
    maxDepth: number,
    breadthLimit: number
  ): GraphNode[] {
    const allDependents: GraphNode[] = [];
    
    for (const node of nodes) {
      const dependents = this.walkBackward(node.id, maxDepth, [
        'imports',
        'calls',
        'references',
      ]);
      allDependents.push(
        ...dependents.filter(dep => dep.id !== node.id && dep.type !== 'file')
      );
    }
    
    const unique = this.dedupeNodes(allDependents);
    return this.limitByBreadth(unique, Math.max(1, breadthLimit));
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

      const dependents = this.walkBackward(node.id, 1, ['calls', 'imports', 'references', 'contains']);
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
    related: GraphNode[],
    breadthLimit: number
  ): {
    target: GraphNode[];
    forward: GraphNode[];
    backward: GraphNode[];
    related: GraphNode[];
  } {
    const uniqueTarget = this.dedupeNodes(target);
    const uniqueForward = this.dedupeNodes(forward);
    const uniqueBackward = this.dedupeNodes(backward);
    const uniqueRelated = this.dedupeNodes(related);

    const targetIds = new Set(uniqueTarget.map(n => n.id));
    const forwardIds = new Set(uniqueForward.map(n => n.id));
    const backwardIds = new Set(uniqueBackward.map(n => n.id));

    uniqueTarget.forEach(n => (n.metadata.category = 'target'));

    const cleanForward = uniqueForward.filter(n => {
      if (targetIds.has(n.id)) return false;
      n.metadata.category = 'forward';
      return true;
    });
    const cleanForwardIds = new Set(cleanForward.map(n => n.id));

    const cleanBackward = uniqueBackward.filter(n => {
      if (targetIds.has(n.id) || cleanForwardIds.has(n.id)) return false;
      n.metadata.category = 'backward';
      return true;
    });
    const cleanBackwardIds = new Set(cleanBackward.map(n => n.id));

    const relatedSet = new Map<string, GraphNode>();
    const cleanRelated = uniqueRelated.filter(n => {
      if (targetIds.has(n.id) || cleanForwardIds.has(n.id) || cleanBackwardIds.has(n.id)) {
        return false;
      }
      n.metadata.category = 'related';
      relatedSet.set(n.id, n);
      return true;
    });

    for (const node of uniqueTarget) {
      const siblings = this.graph
        .getNodesByPath(node.path)
        .filter(sibling => {
          if (sibling.id === node.id) return false;
          if (targetIds.has(sibling.id) || cleanForwardIds.has(sibling.id) || cleanBackwardIds.has(sibling.id)) {
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

    const limitedForward = this.limitByBreadth(cleanForward, Math.max(1, breadthLimit));
    const limitedBackward = this.limitByBreadth(cleanBackward, Math.max(1, breadthLimit));
    const limitedRelated = this.limitByBreadth(cleanRelated, Math.max(1, breadthLimit));

    return {
      target: uniqueTarget,
      forward: limitedForward,
      backward: limitedBackward,
      related: limitedRelated,
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

  private combineSourceScores(candidates: TargetCandidate[]): CandidateSourceScores {
    const totals: CandidateSourceScores = {};
    for (const candidate of candidates) {
      for (const source of Object.keys(candidate.sourceScores) as Array<keyof CandidateSourceScores>) {
        const value = candidate.sourceScores[source];
        if (value === undefined) {
          continue;
        }
        totals[source] = (totals[source] ?? 0) + value;
      }
    }
    return totals;
  }

  private clampTokenBudget(maxTokens: number): number {
    const clamped = Math.min(12000, Math.max(6000, Math.floor(maxTokens)));
    return Number.isFinite(clamped) ? clamped : 6000;
  }

  private dedupeNodes(nodes: GraphNode[]): GraphNode[] {
    const seen = new Set<string>();
    const result: GraphNode[] = [];
    for (const node of nodes) {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        result.push(node);
      }
    }
    return result;
  }

  private limitByBreadth(nodes: GraphNode[], limit: number): GraphNode[] {
    if (nodes.length <= limit) {
      return nodes;
    }
    const scored = nodes
      .map(node => ({ node, score: this.dependencyPriority(node) }))
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(entry => entry.node);
  }

  private dependencyPriority(node: GraphNode): number {
    const exported = node.metadata?.exported === true ? 1 : 0;
    const length = Math.max(node.endLine - node.startLine + 1, 1);
    const locality = 1 / Math.log(length + 1);
    return exported * 2 + locality;
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













