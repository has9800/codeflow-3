import { GraphNode } from '../graph/CodeGraph.js';

interface TokenFrequency {
  token: string;
  frequency: number;
  documentFrequency: number;
}

export class TextSearchEngine {
  private idfCache = new Map<string, number>();
  private readonly minTokenLength = 2;
  private readonly stopWords = new Set([
    'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but',
    'in', 'with', 'to', 'for', 'of', 'as', 'by', 'from', 'this', 'that'
  ]);

  search(
    query: string,
    nodes: GraphNode[],
    topK: number
  ): { nodes: GraphNode[]; scores: number[] } {
    // Tokenize query
    const queryTokens = this.tokenize(query);
    
    if (queryTokens.length === 0) {
      return { nodes: nodes.slice(0, topK), scores: new Array(topK).fill(0.5) };
    }
    
    // Build document frequency map
    this.buildIDF(nodes);
    
    // Score each node using BM25
    const scored = nodes.map(node => ({
      node,
      score: this.bm25Score(queryTokens, node)
    }));
    
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    
    const topResults = scored.slice(0, topK);
    return {
      nodes: topResults.map(s => s.node),
      scores: topResults.map(s => s.score)
    };
  }

  private tokenize(text: string): string[] {
    // Simple tokenization: lowercase, split on non-alphanumeric, filter
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(token => 
        token.length >= this.minTokenLength && 
        !this.stopWords.has(token)
      );
  }

  private buildIDF(nodes: GraphNode[]): void {
    const documentFrequency = new Map<string, number>();
    const totalDocs = nodes.length;
    
    // Count document frequency for each token
    for (const node of nodes) {
      const tokens = new Set(this.tokenize(node.content));
      for (const token of tokens) {
        documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
      }
    }
    
    // Calculate IDF
    this.idfCache.clear();
    for (const [token, df] of documentFrequency.entries()) {
      this.idfCache.set(token, Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1));
    }
  }

  private bm25Score(
    queryTokens: string[],
    node: GraphNode,
    k1: number = 1.5,
    b: number = 0.75
  ): number {
    const docTokens = this.tokenize(node.content);
    const docLength = docTokens.length;
    const avgDocLength = 100; // Approximate average
    
    // Calculate term frequencies in document
    const termFreq = new Map<string, number>();
    for (const token of docTokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }
    
    // Calculate BM25 score
    let score = 0;
    for (const queryToken of queryTokens) {
      const tf = termFreq.get(queryToken) || 0;
      const idf = this.idfCache.get(queryToken) || 0;
      
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));
      
      score += idf * (numerator / denominator);
    }
    
    // Normalize score to 0-1 range
    return Math.min(1, score / (queryTokens.length * 5));
  }

  // Also support exact phrase matching
  containsExactPhrase(text: string, phrase: string): boolean {
    return text.toLowerCase().includes(phrase.toLowerCase());
  }

  // Fuzzy matching for typos (Levenshtein distance)
  fuzzyMatch(a: string, b: string, maxDistance: number = 2): boolean {
    if (Math.abs(a.length - b.length) > maxDistance) return false;
    
    const matrix: number[][] = [];
    
    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= b.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        if (a[i - 1] === b[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[a.length][b.length] <= maxDistance;
  }
}
