import { nanoid } from 'nanoid';

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
  type: 'contains' | 'imports' | 'calls' | 'references';
  metadata: Record<string, unknown>;
}

export class CodeGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  private nodesByPath: Map<string, Set<string>> = new Map();
  private edgesByNode: Map<string, Set<string>> = new Map();

  addNode(node: Omit<GraphNode, 'id'>): GraphNode {
    const fullNode: GraphNode = { ...node, id: nanoid() };
    return this.upsertNode(fullNode);
  }

  addEdge(edge: Omit<GraphEdge, 'id'>): GraphEdge {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error('Cannot add edge: nodes do not exist');
    }
    
    const fullEdge: GraphEdge = { ...edge, id: nanoid() };
    return this.upsertEdge(fullEdge);
  }

  upsertNode(node: GraphNode): GraphNode {
    const existing = this.nodes.get(node.id);

    if (existing) {
      const existingSet = this.nodesByPath.get(existing.path);
      if (existingSet) {
        existingSet.delete(existing.id);
        if (existingSet.size === 0) {
          this.nodesByPath.delete(existing.path);
        }
      }
    }

    this.nodes.set(node.id, node);
    this.indexNodePath(node);
    return node;
  }

  upsertEdge(edge: GraphEdge): GraphEdge {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error('Cannot add edge: nodes do not exist');
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

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getNodesByPath(path: string): GraphNode[] {
    const nodeIds = this.nodesByPath.get(path) || new Set();
    return Array.from(nodeIds).map(id => this.nodes.get(id)!).filter(Boolean);
  }

  getOutgoingEdges(nodeId: string): GraphEdge[] {
    const edgeIds = this.edgesByNode.get(nodeId) || new Set();
    return Array.from(edgeIds).map(id => this.edges.get(id)!).filter(Boolean);
  }

  getNeighbors(nodeId: string, edgeType?: string): GraphNode[] {
    const edges = this.getOutgoingEdges(nodeId);
    const filtered = edgeType ? edges.filter(e => e.type === edgeType) : edges;
    return filtered.map(e => this.nodes.get(e.to)!).filter(Boolean);
  }

  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    
    // Remove from path index
    const pathNodes = this.nodesByPath.get(node.path);
    if (pathNodes) {
      pathNodes.delete(nodeId);
      if (pathNodes.size === 0) {
        this.nodesByPath.delete(node.path);
      }
    }
    
    // Remove all connected edges
    const outgoing = this.edgesByNode.get(nodeId) || new Set();
    outgoing.forEach(edgeId => this.edges.delete(edgeId));
    this.edgesByNode.delete(nodeId);
    
    // Remove incoming edges
    for (const [edgeId, edge] of this.edges.entries()) {
      if (edge.to === nodeId) {
        this.edges.delete(edgeId);
        const fromEdges = this.edgesByNode.get(edge.from);
        if (fromEdges) fromEdges.delete(edgeId);
      }
    }
    
    this.nodes.delete(nodeId);
  }

  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  getAllEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }

  clone(): CodeGraph {
    const cloned = new CodeGraph();
    cloned.nodes = new Map(this.nodes);
    cloned.edges = new Map(this.edges);
    cloned.nodesByPath = new Map(
      Array.from(this.nodesByPath.entries()).map(([k, v]) => [k, new Set(v)])
    );
    cloned.edgesByNode = new Map(
      Array.from(this.edgesByNode.entries()).map(([k, v]) => [k, new Set(v)])
    );
    return cloned;
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

  toJSON(): string {
    return JSON.stringify({
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values())
    });
  }

  static fromJSON(json: string): CodeGraph {
    const data = JSON.parse(json);
    const graph = new CodeGraph();
    
    for (const node of data.nodes) {
      graph.nodes.set(node.id, node);
      if (!graph.nodesByPath.has(node.path)) {
        graph.nodesByPath.set(node.path, new Set());
      }
      graph.nodesByPath.get(node.path)!.add(node.id);
    }
    
    for (const edge of data.edges) {
      graph.edges.set(edge.id, edge);
      if (!graph.edgesByNode.has(edge.from)) {
        graph.edgesByNode.set(edge.from, new Set());
      }
      graph.edgesByNode.get(edge.from)!.add(edge.id);
    }
    
    return graph;
  }
}
