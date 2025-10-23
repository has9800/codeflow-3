import { CodeGraph, GraphNode, GraphEdge } from './CodeGraph.js';

export class GraphWalker {
  constructor(private graph: CodeGraph) {}

  bfs(
    startNodeId: string,
    maxDepth: number,
    edgeTypes?: string[]
  ): GraphNode[] {
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; depth: number }> = [
      { nodeId: startNodeId, depth: 0 }
    ];
    const result: GraphNode[] = [];
    
    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      
      if (visited.has(nodeId) || depth > maxDepth) {
        continue;
      }
      
      visited.add(nodeId);
      const node = this.graph.getNode(nodeId);
      
      if (!node) continue;
      
      result.push(node);
      
      if (depth < maxDepth) {
        const edges = this.graph.getOutgoingEdges(nodeId);
        const filtered = edgeTypes 
          ? edges.filter(e => edgeTypes.includes(e.type))
          : edges;
        
        for (const edge of filtered) {
          if (!visited.has(edge.to)) {
            queue.push({ nodeId: edge.to, depth: depth + 1 });
          }
        }
      }
    }
    
    return result;
  }

  dfs(
    startNodeId: string,
    maxDepth: number,
    edgeTypes?: string[]
  ): GraphNode[] {
    const visited = new Set<string>();
    const result: GraphNode[] = [];
    
    const visit = (nodeId: string, depth: number) => {
      if (visited.has(nodeId) || depth > maxDepth) {
        return;
      }
      
      visited.add(nodeId);
      const node = this.graph.getNode(nodeId);
      
      if (!node) return;
      
      result.push(node);
      
      if (depth < maxDepth) {
        const edges = this.graph.getOutgoingEdges(nodeId);
        const filtered = edgeTypes
          ? edges.filter(e => edgeTypes.includes(e.type))
          : edges;
        
        for (const edge of filtered) {
          visit(edge.to, depth + 1);
        }
      }
    };
    
    visit(startNodeId, 0);
    return result;
  }

  shortestPath(fromNodeId: string, toNodeId: string): GraphNode[] | null {
    const queue: Array<{ nodeId: string; path: string[] }> = [
      { nodeId: fromNodeId, path: [fromNodeId] }
    ];
    const visited = new Set<string>();
    
    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;
      
      if (nodeId === toNodeId) {
        return path.map(id => this.graph.getNode(id)!).filter(Boolean);
      }
      
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      
      const edges = this.graph.getOutgoingEdges(nodeId);
      for (const edge of edges) {
        if (!visited.has(edge.to)) {
          queue.push({
            nodeId: edge.to,
            path: [...path, edge.to]
          });
        }
      }
    }
    
    return null;
  }

  findConnectedComponent(nodeId: string): GraphNode[] {
    return this.bfs(nodeId, 999);
  }
}
