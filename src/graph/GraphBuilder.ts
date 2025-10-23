import * as fs from 'fs/promises';
import * as path from 'path';
import type Parser from 'tree-sitter';
import { CodeGraph, GraphNode } from './CodeGraph.js';
import { TreeSitterParser } from '../parser/TreeSitterParser.js';
import { SymbolExtractor, ExtractedSymbol } from '../parser/SymbolExtractor.js';
import { languageRegistry } from '../parser/LanguageRegistry.js';
import { QwenEmbedder } from '../embeddings/QwenEmbedder.js';
import { EmbeddingCache } from '../embeddings/EmbeddingCache.js';

interface Embedder {
  initialize(): Promise<void>;
  embed(text: string): Promise<number[]>;
}

class NoopEmbedder implements Embedder {
  async initialize(): Promise<void> {
    // No-op
  }

  async embed(_text: string): Promise<number[]> {
    return [];
  }
}

interface GraphBuilderDeps {
  parser?: TreeSitterParser;
  extractor?: SymbolExtractor;
  embedder?: Embedder;
  cache?: EmbeddingCache;
}

export class GraphBuilder {
  private parser: TreeSitterParser;
  private extractor: SymbolExtractor;
  private embedder: Embedder;
  private embeddingsEnabled = true;
  private embeddingCache: EmbeddingCache | null;

  constructor(private rootDir: string, deps: GraphBuilderDeps = {}) {
    this.parser = deps.parser ?? new TreeSitterParser();
    this.extractor = deps.extractor ?? new SymbolExtractor();
    this.embedder = deps.embedder ?? new QwenEmbedder();
    this.embeddingCache = deps.cache ?? new EmbeddingCache(rootDir);
  }

  async build(): Promise<CodeGraph> {
    const graph = new CodeGraph();

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

    const files = await this.findSourceFiles();

    for (const filePath of files) {
      await this.processFile(filePath, graph);
    }

    if (this.embeddingCache && this.embeddingsEnabled) {
      await this.embeddingCache.flush();
    }

    return graph;
  }

  private async findSourceFiles(): Promise<string[]> {
    const files: string[] = [];
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py'];

    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip common ignore patterns
        if (this.shouldIgnore(entry.name)) continue;

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (extensions.some(ext => entry.name.endsWith(ext))) {
          files.push(path.relative(this.rootDir, fullPath));
        }
      }
    };

    await walk(this.rootDir);
    return files;
  }

  private shouldIgnore(name: string): boolean {
    const ignorePatterns = [
      'node_modules',
      '.git',
      'dist',
      'build',
      '.next',
      'coverage',
      '.codeflow',
    ];

    return ignorePatterns.includes(name) || name.startsWith('.');
  }

  private async processFile(filePath: string, graph: CodeGraph): Promise<void> {
    const fullPath = path.join(this.rootDir, filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    const language = languageRegistry.inferFromPath(filePath);

    if (!language) return;

    const tree = await this.parser.parse(content, language);
    const symbols = this.extractor.extractSymbols(tree, language);

    const fileNode = graph.addNode({
      type: 'file',
      name: path.basename(filePath),
      path: filePath,
      content: content.slice(0, 200),
      startLine: 1,
      endLine: content.split('\n').length,
      metadata: { language },
    });

    const symbolEntries: Array<{ symbol: ExtractedSymbol; node: GraphNode }> = [];

    for (const symbol of symbols) {
      let embedding: number[] | undefined;
      if (this.embeddingsEnabled) {
        embedding = this.embeddingCache?.get(symbol.content);
        if (!embedding) {
          embedding = await this.embedder.embed(symbol.content);
          this.embeddingCache?.set(symbol.content, embedding);
        }
      }

      const symbolNode = graph.addNode({
        type: symbol.type,
        name: symbol.name,
        path: filePath,
        content: symbol.content,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        embedding,
        metadata: {
          exported: symbol.exported ?? false,
          language,
          kind: symbol.kind ?? symbol.type,
        },
      });

      symbolEntries.push({ symbol, node: symbolNode });

      graph.addEdge({
        from: fileNode.id,
        to: symbolNode.id,
        type: 'contains',
        metadata: {},
      });
    }

    this.analyzeCallsWithinFile(tree, symbolEntries, graph, language);
    await this.analyzeImports(symbols, fileNode, graph);
  }

  private analyzeCallsWithinFile(
    tree: Parser.Tree,
    symbols: Array<{ symbol: ExtractedSymbol; node: GraphNode }>,
    graph: CodeGraph,
    language: string
  ): void {
    const functionSymbols = symbols.filter(entry => entry.symbol.type === 'function');
    if (functionSymbols.length === 0) {
      return;
    }

    const symbolsByName = new Map<string, GraphNode[]>();
    for (const entry of symbols) {
      if (!symbolsByName.has(entry.symbol.name)) {
        symbolsByName.set(entry.symbol.name, []);
      }
      symbolsByName.get(entry.symbol.name)!.push(entry.node);
    }

    const createdEdges = new Set<string>();

    const visit = (node: Parser.SyntaxNode) => {
      if (this.isCallExpression(node, language)) {
        const calleeName = this.extractCalleeName(node, language);
        if (calleeName) {
          const targets = symbolsByName.get(calleeName) ?? [];
          if (targets.length > 0) {
            const caller = this.findEnclosingFunction(node, functionSymbols);
            if (caller) {
              for (const target of targets) {
                if (target.id === caller.node.id) continue;
                const key = `${caller.node.id}->${target.id}`;
                if (createdEdges.has(key)) continue;
                graph.addEdge({
                  from: caller.node.id,
                  to: target.id,
                  type: 'calls',
                  metadata: {
                    scope: caller.node.path === target.path ? 'local' : 'cross-file',
                  },
                });
                createdEdges.add(key);
              }
            }
          }
        }
      }

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) visit(child);
      }
    };

    visit(tree.rootNode);
  }

  private isCallExpression(node: Parser.SyntaxNode, language: string): boolean {
    if (language === 'python') {
      return node.type === 'call';
    }
    return node.type === 'call_expression';
  }

  private extractCalleeName(node: Parser.SyntaxNode, language: string): string | null {
    const functionNode = node.childForFieldName('function') ?? node.child(0);
    if (!functionNode) return null;

    if (functionNode.type === 'identifier') {
      return functionNode.text;
    }

    if (language === 'python' && functionNode.type === 'identifier') {
      return functionNode.text;
    }

    if (
      ['member_expression', 'subscript_expression', 'attribute'].includes(functionNode.type)
    ) {
      const property =
        functionNode.childForFieldName('property') ??
        functionNode.child(functionNode.childCount - 1);
      return property?.type === 'property_identifier' || property?.type === 'identifier'
        ? property.text
        : null;
    }

    return null;
  }

  private findEnclosingFunction(
    node: Parser.SyntaxNode,
    candidates: Array<{ symbol: ExtractedSymbol; node: GraphNode }>
  ): { symbol: ExtractedSymbol; node: GraphNode } | null {
    const start = node.startIndex;
    const end = node.endIndex;

    let best: { symbol: ExtractedSymbol; node: GraphNode } | null = null;

    for (const entry of candidates) {
      if (
        entry.symbol.startIndex <= start &&
        entry.symbol.endIndex >= end
      ) {
        if (!best) {
          best = entry;
          continue;
        }
        const currentRange = entry.symbol.endIndex - entry.symbol.startIndex;
        const bestRange = best.symbol.endIndex - best.symbol.startIndex;
        if (currentRange < bestRange) {
          best = entry;
        }
      }
    }

    return best;
  }

  /**
   * Analyze imports and create cross-file edges
   */
  private async analyzeImports(
    symbols: ExtractedSymbol[],
    fileNode: GraphNode,
    graph: CodeGraph
  ): Promise<void> {
    const imports = symbols.filter(s => s.type === 'import');
    
    for (const imp of imports) {
      // Extract import path
      const importPath = this.extractImportPath(imp.content);
      if (!importPath) continue;
      
      // Resolve to actual file
      const resolvedPath = await this.resolveImportPath(importPath, fileNode.path);
      if (!resolvedPath) continue;
    
    // Find imported file node
    const importedFiles = graph.getNodesByPath(resolvedPath);
    if (importedFiles.length === 0) continue;
    
    const importedFile = importedFiles.find(n => n.type === 'file');
    if (!importedFile) continue;
    
    // Create import edge
    graph.addEdge({
      from: fileNode.id,
      to: importedFile.id,
      type: 'imports',
      metadata: { importPath },
    });
    
    // Also link to specific imported symbols if we can detect them
      const importedSymbols = this.extractImportedSymbols(imp.content);
      for (const symbolName of importedSymbols) {
        const symbolNode = graph
          .getNodesByPath(resolvedPath)
          .find(n => n.name === symbolName && n.type !== 'file');
      
      if (symbolNode) {
        graph.addEdge({
          from: fileNode.id,
          to: symbolNode.id,
          type: 'imports',
          metadata: { importPath, symbol: symbolName },
        });
      }
    }
  }
}

private extractImportPath(importStatement: string): string | null {
  // Match: import ... from 'path' or import ... from "path"
  const match = importStatement.match(/from\s+['"]([^'"]+)['"]/);
  return match ? match[1] : null;
}

private extractImportedSymbols(importStatement: string): string[] {
  // Match: import { a, b, c } from ...
  const match = importStatement.match(/import\s+\{([^}]+)\}/);
  if (!match) return [];
  
  return match[1]
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

  private async resolveImportPath(importPath: string, fromFile: string): Promise<string | null> {
    if (!importPath.startsWith('.')) {
      return null;
    }

    const fromDir = path.dirname(fromFile);
    const basePath = path.normalize(path.join(fromDir, importPath));

    const candidates = new Set<string>([basePath]);

    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.py'];
    for (const ext of extensions) {
      candidates.add(basePath + ext);
    }

    const indexFiles = extensions.map(ext => path.join(basePath, `index${ext}`));
    for (const indexFile of indexFiles) {
      candidates.add(indexFile);
    }

    for (const candidate of candidates) {
      if (await this.fileExists(candidate)) {
        return path.normalize(candidate);
      }
    }

    return null;
  }

  private async fileExists(relativePath: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.rootDir, relativePath);
      const stats = await fs.stat(fullPath);
      return stats.isFile();
    } catch {
      return false;
    }
  }

}
