import type { GraphEdge, GraphNode } from './CodeGraph.js';
import type { SupportedLanguage } from '../parser/LanguageRegistry.js';

export interface FileGraphSnapshot {
  filePath: string;
  language: SupportedLanguage;
  file: GraphNode;
  symbols: GraphNode[];
  edges: GraphEdge[];
  digest: string;
}

export interface GraphSnapshot {
  files: FileGraphSnapshot[];
  createdAt: number;
}
