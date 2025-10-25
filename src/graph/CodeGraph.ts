import { randomUUID } from 'crypto';

export interface GraphNode {
  id: string;
  type: 'file' | 'function' | 'class' | 'import';
  name: string;
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  embedding?: number[];
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: 'contains' | 'imports' | 'calls' | 'references' | 'extends' | 'implements';
  metadata: Record<string, unknown>;
}

export class CodeGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private nodesByPath: Map<string, Set<string>> = new Map();
  private edgesByNode: Map<string, Set<string>> = new Map();

  addNode(node: GraphNode | Omit<GraphNode, 'id'>): GraphNode {
    const fullNode: GraphNode = 'id' in node ? node : { ...node, id: randomUUID() };
    return this.upsertNode(fullNode);
  }

  addEdge(edge: GraphEdge | Omit<GraphEdge, 'id'>): GraphEdge {
    const fullEdge: GraphEdge = 'id' in edge ? edge : { ...edge, id: randomUUID() };
    return this.upsertEdge(fullEdge);
  }

  upsertNode(node: GraphNode): GraphNode {
    const existing = this.nodes.get(node.id);
    if (existing) {
      const pathSet = this.nodesByPath.get(existing.path);
      pathSet?.delete(existing.id);
      if (pathSet && pathSet.size === 0) {
        this.nodesByPath.delete(existing.path);
      }
    }

    this.nodes.set(node.id, node);
    this.indexNodePath(node);
    return node;
  }

  upsertEdge(edge: GraphEdge): GraphEdge {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error(`Cannot add edge: missing nodes ${edge.from} -> ${edge.to}`);
    }

    const existing = this.edges.get(edge.id);
    if (existing) {
      const fromSet = this.edgesByNode.get(existing.from);
      fromSet?.delete(existing.id);
    }

    this.edges.set(edge.id, edge);
    this.indexEdge(edge);
    return edge;
  }

  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    // Remove from path index
    const pathNodes = this.nodesByPath.get(node.path);
    pathNodes?.delete(nodeId);
    if (pathNodes && pathNodes.size === 0) {
      this.nodesByPath.delete(node.path);
    }

    // Remove all connected edges (outgoing)
    const outgoing = this.edgesByNode.get(nodeId);
    if (outgoing) {
      for (const edgeId of outgoing) {
        this.edges.delete(edgeId);
      }
    }
    this.edgesByNode.delete(nodeId);

    // Remove incoming edges
    for (const [edgeId, edge] of this.edges.entries()) {
      if (edge.to === nodeId) {
        this.edges.delete(edgeId);
        const fromEdges = this.edgesByNode.get(edge.from);
        fromEdges?.delete(edgeId);
      }
    }

    this.nodes.delete(nodeId);
  }

  removeNodesByPath(path: string): void {
    const nodeIds = this.nodesByPath.get(path);
    if (!nodeIds) return;
    const ids = Array.from(nodeIds);
    for (const id of ids) {
      this.removeNode(id);
    }
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  getNodesByPath(path: string): GraphNode[] {
    const nodeIds = this.nodesByPath.get(path);
    if (!nodeIds) {
      return [];
    }
    const result: GraphNode[] = [];
    for (const id of nodeIds) {
      const node = this.nodes.get(id);
      if (node) {
        result.push(node);
      }
    }
    return result;
  }

  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  getAllEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }

  getOutgoingEdges(nodeId: string): GraphEdge[] {
    const edgeIds = this.edgesByNode.get(nodeId);
    if (!edgeIds) {
      return [];
    }
    const result: GraphEdge[] = [];
    for (const id of edgeIds) {
      const edge = this.edges.get(id);
      if (edge) {
        result.push(edge);
      }
    }
    return result;
  }

  getNeighbors(nodeId: string, edgeType?: string): GraphNode[] {
    const edges = this.getOutgoingEdges(nodeId);
    const filtered = edgeType ? edges.filter(e => e.type === edgeType) : edges;
    return filtered
      .map(edge => this.nodes.get(edge.to))
      .filter((node): node is GraphNode => Boolean(node));
  }

  clone(): CodeGraph {
    const cloned = new CodeGraph();
    cloned.nodes = new Map(this.nodes);
    cloned.edges = new Map(this.edges);
    cloned.nodesByPath = new Map(
      Array.from(this.nodesByPath.entries()).map(([path, ids]) => [path, new Set(ids)])
    );
    cloned.edgesByNode = new Map(
      Array.from(this.edgesByNode.entries()).map(([from, ids]) => [from, new Set(ids)])
    );
    return cloned;
  }

  toJSON(): string {
    return JSON.stringify({
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
    });
  }

  static fromJSON(json: string): CodeGraph {
    const data = JSON.parse(json);
    const graph = new CodeGraph();

    for (const node of data.nodes as GraphNode[]) {
      graph.nodes.set(node.id, node);
      if (!graph.nodesByPath.has(node.path)) {
        graph.nodesByPath.set(node.path, new Set());
      }
      graph.nodesByPath.get(node.path)!.add(node.id);
    }

    for (const edge of data.edges as GraphEdge[]) {
      graph.edges.set(edge.id, edge);
      if (!graph.edgesByNode.has(edge.from)) {
        graph.edgesByNode.set(edge.from, new Set());
      }
      graph.edgesByNode.get(edge.from)!.add(edge.id);
    }

    return graph;
  }

  private indexNodePath(node: GraphNode): void {
    if (!this.nodesByPath.has(node.path)) {
      this.nodesByPath.set(node.path, new Set());
    }
    this.nodesByPath.get(node.path)!.add(node.id);
  }

  private indexEdge(edge: GraphEdge): void {
    if (!this.edgesByNode.has(edge.from)) {
      this.edgesByNode.set(edge.from, new Set());
    }
    this.edgesByNode.get(edge.from)!.add(edge.id);
  }
}
