import crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type Parser from 'tree-sitter';
import { CodeGraph, type GraphEdge, type GraphNode } from './CodeGraph.js';
import { TreeSitterParser } from '../parser/TreeSitterParser.js';
import { SymbolExtractor, type ExtractedSymbol, type SymbolReference } from '../parser/SymbolExtractor.js';
import { languageRegistry, type SupportedLanguage } from '../parser/LanguageRegistry.js';
import { QwenEmbedder } from '../embeddings/QwenEmbedder.js';
import { EmbeddingCache } from '../embeddings/EmbeddingCache.js';
import { FileGraphSnapshot } from './types.js';

interface Embedder {
  initialize(): Promise<void>;
  embed(text: string): Promise<number[]>;
}

class NoopEmbedder implements Embedder {
  async initialize(): Promise<void> {
    // intentionally empty
  }

  async embed(_text: string): Promise<number[]> {
    return [];
  }
}

interface GraphBuilderDeps {
  parser?: TreeSitterParser;
  extractor?: SymbolExtractor;
  embedder?: Embedder;
  cache?: EmbeddingCache | null;
}

interface SymbolEdge {
  from: string;
  to: string;
  type: GraphEdge['type'];
  metadata: Record<string, unknown>;
}

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.codeflow',
  'benchmarks',
  'docs',
]);

export class GraphBuilder {
  private readonly parser: TreeSitterParser;
  private readonly extractor: SymbolExtractor;
  private embedder: Embedder;
  private readonly embeddingCache: EmbeddingCache | null;
  private embeddingsEnabled = true;

  constructor(private readonly rootDir: string, deps: GraphBuilderDeps = {}) {
    this.parser = deps.parser ?? new TreeSitterParser();
    this.extractor = deps.extractor ?? new SymbolExtractor();
    this.embedder = deps.embedder ?? new QwenEmbedder();
    this.embeddingCache = deps.cache ?? new EmbeddingCache(rootDir);
  }

  async build(): Promise<CodeGraph> {
    const graph = new CodeGraph();
    await this.prepareEmbeddingPipeline();

    const filePaths = await this.findSourceFiles();
    const snapshots: FileGraphSnapshot[] = [];

    for (const filePath of filePaths) {
      const snapshot = await this.buildFileSnapshot(filePath);
      if (snapshot) {
        snapshots.push(snapshot);
      }
    }

    const uniquePaths = new Set(snapshots.map(snapshot => snapshot.filePath));
    for (const filePath of uniquePaths) {
      graph.removeNodesByPath(filePath);
    }

    for (const snapshot of snapshots) {
      graph.upsertNode(snapshot.file);
      for (const node of snapshot.symbols) {
        graph.upsertNode(node);
      }
    }

    const exportedIndex = this.buildExportedIndexFromSnapshots(snapshots);
    const allEdges = snapshots.flatMap(snapshot => snapshot.edges);
    const resolvedEdges = this.resolveEdges(graph, allEdges, exportedIndex);
    for (const edge of resolvedEdges) {
      graph.upsertEdge(edge);
    }

    await this.flushEmbeddingCache();
    return graph;
  }

  /**
   * Build a graph snapshot for a single file without mutating a graph instance.
   * Throws on critical parser failures to surface invalid files early.
   */
  async buildFileSnapshot(filePath: string): Promise<FileGraphSnapshot | null> {
    const fullPath = path.join(this.rootDir, filePath);
    let content: string;
    try {
      content = await fs.readFile(fullPath, 'utf-8');
    } catch {
      return null;
    }

    const language = languageRegistry.inferFromPath(filePath);
    if (!language) {
      return null;
    }
    if (language === 'json' || language === 'markdown') {
      return null;
    }

    const tree = await this.parseContent(content, language, fullPath);
    const rootDigest = this.digest(tree.rootNode.text);

    const fileNode: GraphNode = {
      id: this.createFileNodeId(filePath),
      type: 'file',
      name: path.basename(filePath),
      path: filePath,
      content,
      startLine: 1,
      endLine: content.split(/\r?\n/).length,
      metadata: {
        language,
        digest: rootDigest,
      },
    };

    const analysis = this.extractor.extractGraphData(tree, language);
    const symbolIndex = new Map<string, ExtractedSymbol>();
    const rangeIndex = new Map<string, string>();
    const nameIndex = new Map<string, GraphNode[]>();
    const nodeIndex = new Map<string, GraphNode>();

    const symbolNodes = await this.createSymbolNodes(
      filePath,
      analysis.symbols,
      symbolIndex,
      rangeIndex,
      nameIndex
    );
    for (const node of symbolNodes) {
      nodeIndex.set(node.id, node);
    }

    const containsEdges = this.buildContainmentEdges(fileNode.id, symbolNodes);
    const parentEdges = this.buildParentEdges(symbolIndex, nodeIndex, nameIndex);
    const importGraph = await this.buildImportEdges(
      filePath,
      analysis.symbols,
      fileNode.id,
      symbolNodes
    );
    const referenceEdges = this.buildReferenceEdges(
      filePath,
      analysis.references,
      rangeIndex,
      nameIndex,
      importGraph.symbolMap,
      nodeIndex
    );

    return {
      filePath,
      language,
      file: fileNode,
      symbols: symbolNodes,
      edges: [
        ...containsEdges,
        ...parentEdges,
        ...importGraph.edges,
        ...referenceEdges,
      ],
      digest: rootDigest,
    };
  }

  /**
   * Apply a snapshot into an existing graph. This method removes any previous
   * nodes/edges associated with the file before inserting the refreshed data.
   */
  private async prepareEmbeddingPipeline(): Promise<void> {
    if (process.env.CODEFLOW_DISABLE_EMBEDDINGS === '1') {
      this.embedder = new NoopEmbedder();
      this.embeddingsEnabled = false;
    } else {
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

    if (this.embeddingCache) {
      await this.embeddingCache.prepare();
      if (!this.embeddingsEnabled) {
        this.embeddingCache.clear();
      }
    }
  }

  private async findSourceFiles(): Promise<string[]> {
    const files: string[] = [];

    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORED_DIRECTORIES.has(entry.name) || entry.name.startsWith('.')) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }

        const relative = path.relative(this.rootDir, fullPath);
        const language = languageRegistry.inferFromPath(relative);
        if (language) {
          files.push(relative);
        }
      }
    };

    await walk(this.rootDir);
    return files;
  }

  private async createSymbolNodes(
    filePath: string,
    symbols: ExtractedSymbol[],
    symbolIndex: Map<string, ExtractedSymbol>,
    rangeIndex: Map<string, string>,
    nameIndex: Map<string, GraphNode[]>
  ): Promise<GraphNode[]> {
    const nodes: GraphNode[] = [];
    for (const symbol of symbols) {
      if (symbol.type === 'import') {
        continue;
      }

      const id = this.createSymbolNodeId(filePath, symbol);
      let embedding: number[] | undefined;

      if (this.embeddingsEnabled) {
        embedding = this.embeddingCache?.get(symbol.content);
        if (!embedding) {
          embedding = await this.embedder.embed(symbol.content);
          this.embeddingCache?.set(symbol.content, embedding);
        }
      }

      const metadata: Record<string, unknown> = {
        exported: symbol.exported,
        kind: symbol.kind,
        astType: symbol.astType,
        parentName: symbol.parentName,
        parentType: symbol.parentType,
        documentation: symbol.documentation,
        parameters: symbol.parameters,
        returnType: symbol.returnType,
        signature: symbol.signature,
        startIndex: symbol.startIndex,
        endIndex: symbol.endIndex,
      };
      if (symbol.exported) {
        metadata.symbolKey = this.createSymbolKey(filePath, symbol.name);
      }

      const node: GraphNode = {
        id,
        type: symbol.type,
        name: symbol.name,
        path: filePath,
        content: symbol.content,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        embedding,
        metadata,
      };

      nodes.push(node);
      symbolIndex.set(id, symbol);
      rangeIndex.set(this.createRangeKey(symbol.startIndex, symbol.endIndex), id);
      const nameBucket = nameIndex.get(symbol.name) ?? [];
      nameBucket.push(node);
      nameIndex.set(symbol.name, nameBucket);
    }
    return nodes;
  }

  private buildContainmentEdges(fileNodeId: string, symbolNodes: GraphNode[]): GraphEdge[] {
    return symbolNodes.map(node => ({
      id: this.createEdgeId(fileNodeId, node.id, 'contains'),
      from: fileNodeId,
      to: node.id,
      type: 'contains',
      metadata: { source: 'ast' },
    }));
  }

  private buildParentEdges(
    symbolIndex: Map<string, ExtractedSymbol>,
    nodeIndex: Map<string, GraphNode>,
    nameIndex: Map<string, GraphNode[]>
  ): GraphEdge[] {
    const edges: GraphEdge[] = [];

    for (const [nodeId, symbol] of symbolIndex.entries()) {
      if (!symbol.parentName) {
        continue;
      }

      const potentialParents = nameIndex.get(symbol.parentName);
      if (!potentialParents) {
        continue;
      }

      const parentNode = potentialParents.find(candidate => candidate.type === symbol.parentType);
      if (!parentNode) {
        continue;
      }

      const childNode = nodeIndex.get(nodeId);
      if (!childNode) {
        continue;
      }

      edges.push({
        id: this.createEdgeId(parentNode.id, childNode.id, 'contains'),
        from: parentNode.id,
        to: childNode.id,
        type: 'contains',
        metadata: { source: 'ast-parent' },
      });
    }

    return edges;
  }

  private buildReferenceEdges(
    filePath: string,
    references: SymbolReference[],
    rangeIndex: Map<string, string>,
    nameIndex: Map<string, GraphNode[]>,
    importSymbolMap: Map<string, string>,
    nodeIndex: Map<string, GraphNode>
  ): GraphEdge[] {
    const edges: GraphEdge[] = [];

    for (const reference of references) {
      const sourceId = rangeIndex.get(
        this.createRangeKey(reference.sourceStartIndex, reference.sourceEndIndex)
      );
      if (!sourceId) {
        continue;
      }

      const sourceNode = nodeIndex.get(sourceId);
      if (!sourceNode) {
        continue;
      }

      let targetNodeId: string | null = null;
      let targetFilePath = filePath;

      const localTargets = nameIndex.get(reference.targetName);
      if (localTargets && localTargets.length > 0) {
        const candidate = localTargets.find(node => node.id !== sourceId) ?? localTargets[0];
        if (candidate) {
          targetNodeId = candidate.id;
          targetFilePath = candidate.path;
        }
      }

      if (!targetNodeId) {
        const mappedPath = importSymbolMap.get(reference.targetName);
        if (mappedPath) {
          targetFilePath = mappedPath;
        }
        targetNodeId = this.createPlaceholderSymbolId(targetFilePath, reference.targetName);
      }

      if (targetNodeId === sourceId) {
        continue;
      }

      const edgeType: GraphEdge['type'] =
        reference.kind === 'call' ? 'calls' : reference.kind;

      const metadata: Record<string, unknown> = {
        source: 'ast',
        kind: reference.kind,
        targetFilePath,
        symbol: reference.targetName,
      };

      if (reference.targetModule) {
        metadata.targetModule = reference.targetModule;
      }

      edges.push({
        id: this.createEdgeId(sourceId, targetNodeId, edgeType),
        from: sourceId,
        to: targetNodeId,
        type: edgeType,
        metadata,
      });
    }

    return edges;
  }

  private async buildImportEdges(
    filePath: string,
    symbols: ExtractedSymbol[],
    fileNodeId: string,
    symbolNodes: GraphNode[]
  ): Promise<{ edges: GraphEdge[]; symbolMap: Map<string, string> }> {
    const edges: SymbolEdge[] = [];
    const imports = symbols.filter(symbol => symbol.type === 'import');
    const functionNodes = symbolNodes.filter(node => node.type === 'function');
    const symbolMap = new Map<string, string>();

    for (const imp of imports) {
      const importPath = this.extractImportPath(imp.content);
      if (!importPath) continue;

      const resolved = await this.resolveImportPath(importPath, filePath);
      if (!resolved) continue;

      const targetFileId = this.createFileNodeId(resolved);
      edges.push({
        from: fileNodeId,
        to: targetFileId,
        type: 'imports',
        metadata: { importPath, targetFilePath: resolved, source: 'import' },
      });

      // Attempt to connect to referenced symbols within the target file
      const importedSymbols = this.extractImportedSymbols(imp.content);
      for (const symbolName of importedSymbols) {
        symbolMap.set(symbolName, resolved);
        const placeholderId = this.createPlaceholderSymbolId(resolved, symbolName);
        edges.push({
          from: fileNodeId,
          to: placeholderId,
          type: 'references',
          metadata: {
            importPath,
            symbol: symbolName,
            targetFilePath: resolved,
            source: 'import',
          },
        });

        const invocationRegex = new RegExp(`\\b${symbolName}\\s*\\(`);
        for (const fn of functionNodes) {
          if (invocationRegex.test(fn.content)) {
            edges.push({
              from: fn.id,
              to: placeholderId,
              type: 'calls',
              metadata: {
                importPath,
                symbol: symbolName,
                targetFilePath: resolved,
                source: 'import',
              },
            });
          }
        }
      }
    }

    return {
      edges: edges.map(edge => ({
        id: this.createEdgeId(edge.from, edge.to, edge.type),
        from: edge.from,
        to: edge.to,
        type: edge.type,
        metadata: edge.metadata,
      })),
      symbolMap,
    };
  }

  private extractImportPath(importStatement: string): string | null {
    const fromMatch = importStatement.match(/from\s+['"]([^'"]+)['"]/);
    if (fromMatch) {
      return fromMatch[1];
    }

    const requireMatch = importStatement.match(/require\(['"]([^'"]+)['"]\)/);
    if (requireMatch) {
      return requireMatch[1];
    }

    return null;
  }

  private extractImportedSymbols(importStatement: string): string[] {
    const symbols = new Set<string>();

    const namedMatch = importStatement.match(/import\s+\{([^}]+)\}/);
    if (namedMatch) {
      namedMatch[1]
        .split(',')
        .map(symbol => symbol.trim())
        .filter(Boolean)
        .forEach(symbols.add, symbols);
    }

    const defaultMatch = importStatement.match(/import\s+([A-Za-z0-9_]+)\s+from/);
    if (defaultMatch) {
      symbols.add(defaultMatch[1]);
    }

    const namespaceMatch = importStatement.match(/import\s+\*\s+as\s+([A-Za-z0-9_]+)/);
    if (namespaceMatch) {
      symbols.add(namespaceMatch[1]);
    }

    return Array.from(symbols);
  }

  private async resolveImportPath(importPath: string, fromFile: string): Promise<string | null> {
    if (!importPath.startsWith('.')) {
      return null;
    }

    const baseDir = path.dirname(fromFile);
    const normalized = path.normalize(path.join(baseDir, importPath));
    const candidates = new Set<string>([normalized]);

    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'];
    for (const ext of extensions) {
      candidates.add(`${normalized}${ext}`);
    }
    for (const ext of extensions) {
      candidates.add(path.join(normalized, `index${ext}`));
    }

    for (const candidate of candidates) {
      const candidatePath = path.join(this.rootDir, candidate);
      try {
        const stats = await fs.stat(candidatePath);
        if (stats.isFile()) {
          return path.normalize(candidate);
        }
      } catch {
        // ignore
      }
    }

    return null;
  }

  private async parseContent(
    content: string,
    language: SupportedLanguage,
    filePath: string
  ): Promise<Parser.Tree> {
    try {
      return await this.parser.parse(content, language);
    } catch (error) {
      throw new Error(`Failed to parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private createFileNodeId(filePath: string): string {
    return this.digest(`file:${filePath}`);
  }

  private createSymbolNodeId(filePath: string, symbol: ExtractedSymbol): string {
    return this.digest(
      [
        'symbol',
        filePath,
        symbol.type,
        symbol.name,
        symbol.startLine,
        symbol.endLine,
        symbol.kind ?? '',
      ].join(':')
    );
  }

  private createPlaceholderSymbolId(filePath: string, symbolName: string): string {
    return this.digest(['placeholder', filePath, symbolName].join(':'));
  }

  private createSymbolKey(filePath: string, symbolName: string): string {
    return `${filePath}#${symbolName}`;
  }

  private createRangeKey(startIndex: number, endIndex: number): string {
    return `${startIndex}:${endIndex}`;
  }

  private buildExportedIndexFromSnapshots(
    snapshots: FileGraphSnapshot[]
  ): Map<string, string> {
    const index = new Map<string, string>();
    for (const snapshot of snapshots) {
      for (const node of snapshot.symbols) {
        const key = this.createSymbolKey(snapshot.filePath, node.name);
        if (!index.has(key) || node.metadata?.exported === true) {
          index.set(key, node.id);
        }
      }
    }
    return index;
  }

  static buildExportedIndexFromGraph(graph: CodeGraph): Map<string, string> {
    const index = new Map<string, string>();
    for (const node of graph.getAllNodes()) {
      if (node.type !== 'function' && node.type !== 'class') {
        continue;
      }
      const key = `${node.path}#${node.name}`;
      if (!index.has(key) || node.metadata?.exported === true) {
        index.set(key, node.id);
      }
    }
    return index;
  }

  resolveEdges(
    graph: CodeGraph,
    edges: GraphEdge[],
    exportedIndex: Map<string, string>
  ): GraphEdge[] {
    const resolved: GraphEdge[] = [];
    for (const edge of edges) {
      const candidate = this.resolveEdge(graph, edge, exportedIndex);
      if (candidate) {
        resolved.push(candidate);
      }
    }
    return resolved;
  }

  private resolveEdge(
    graph: CodeGraph,
    edge: GraphEdge,
    exportedIndex: Map<string, string>
  ): GraphEdge | null {
    if (!graph.hasNode(edge.from)) {
      return null;
    }

    let targetId = edge.to;
    if (!graph.hasNode(targetId)) {
      const targetFilePath = edge.metadata?.targetFilePath as string | undefined;
      const symbolName = edge.metadata?.symbol as string | undefined;
      if (targetFilePath && symbolName) {
        const key = this.createSymbolKey(targetFilePath, symbolName);
        const mapped = exportedIndex.get(key);
        if (!mapped) {
          return null;
        }
        targetId = mapped;
      } else {
        return null;
      }
    }

    if (!graph.hasNode(targetId)) {
      return null;
    }

    return {
      ...edge,
      id: this.createEdgeId(edge.from, targetId, edge.type),
      to: targetId,
    };
  }

  private createEdgeId(from: string, to: string, type: GraphEdge['type']): string {
    return this.digest(['edge', from, to, type].join(':'));
  }

  private digest(value: string): string {
    return crypto.createHash('sha1').update(value).digest('hex');
  }

  private async flushEmbeddingCache(): Promise<void> {
    if (this.embeddingCache && this.embeddingsEnabled) {
      await this.embeddingCache.flush();
    }
  }
}
