import { CodeGraph, GraphNode, GraphEdge } from './CodeGraph.js';

export interface DiffOperation {
  type: 'add' | 'remove' | 'modify';
  nodeId?: string;
  edgeId?: string;
  node?: GraphNode;
  edge?: GraphEdge;
  timestamp: number;
}

export class DiffOverlay {
  private operations: DiffOperation[] = [];
  private modifiedPaths: Set<string> = new Set();
  
  constructor(
    public readonly id: string,
    public readonly baseGraphSnapshot: string
  ) {}

  addOperation(op: Omit<DiffOperation, 'timestamp'>): void {
    this.operations.push({
      ...op,
      timestamp: Date.now()
    });
    
    if (op.node) {
      this.modifiedPaths.add(op.node.path);
    }
  }

  getOperations(): DiffOperation[] {
    return [...this.operations];
  }

  getModifiedPaths(): Set<string> {
    return new Set(this.modifiedPaths);
  }

  apply(baseGraph: CodeGraph): CodeGraph {
    const graph = baseGraph.clone();
    
    for (const op of this.operations) {
      switch (op.type) {
        case 'add':
          if (op.node) {
            graph.upsertNode(op.node);
          } else if (op.edge) {
            graph.upsertEdge(op.edge);
          }
          break;
          
        case 'remove':
          if (op.nodeId) {
            graph.removeNode(op.nodeId);
          }
          break;
          
        case 'modify':
          if (op.node) {
            graph.upsertNode(op.node);
          }
          break;
      }
    }
    
    return graph;
  }

  size(): number {
    return this.operations.length;
  }

  isEmpty(): boolean {
    return this.operations.length === 0;
  }

  toJSON(): string {
    return JSON.stringify({
      id: this.id,
      baseGraphSnapshot: this.baseGraphSnapshot,
      operations: this.operations,
      modifiedPaths: Array.from(this.modifiedPaths)
    });
  }

  static fromJSON(json: string): DiffOverlay {
    const data = JSON.parse(json);
    const overlay = new DiffOverlay(data.id, data.baseGraphSnapshot);
    overlay.operations = data.operations;
    overlay.modifiedPaths = new Set(data.modifiedPaths);
    return overlay;
  }
}
