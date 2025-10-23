import * as fs from 'fs/promises';
import * as path from 'path';
import { CodeGraph, GraphNode } from './CodeGraph.js';
import { TreeSitterParser } from '../parser/TreeSitterParser.js';
import { SymbolExtractor, ExtractedSymbol } from '../parser/SymbolExtractor.js';
import { QwenEmbedder } from '../embeddings/QwenEmbedder.js';

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

export class GraphBuilder {
  private parser: TreeSitterParser;
  private extractor: SymbolExtractor;
  private embedder: Embedder;
  private embeddingsEnabled = true;

  constructor(private rootDir: string) {
    this.parser = new TreeSitterParser();
    this.extractor = new SymbolExtractor();
    this.embedder = new QwenEmbedder();
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

    const files = await this.findSourceFiles();

    for (const filePath of files) {
      await this.processFile(filePath, graph);
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
    const ext = path.extname(filePath);
    const language = this.getLanguage(ext);

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

    const symbolNodes: GraphNode[] = [];

    for (const symbol of symbols) {
      const symbolNode = graph.addNode({
        type: symbol.type,
        name: symbol.name,
        path: filePath,
        content: symbol.content,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
      embedding: this.embeddingsEnabled
        ? await this.embedder.embed(symbol.content)
        : undefined,
        metadata: {},
      });

      symbolNodes.push(symbolNode);

      graph.addEdge({
        from: fileNode.id,
        to: symbolNode.id,
        type: 'contains',
        metadata: {},
      });
    }

    this.analyzeCallsWithinFile(symbolNodes, graph, content, language);
    await this.analyzeImports(symbols, fileNode, graph);
  }

/**
 * Analyze function calls within the same file
 */
private analyzeCallsWithinFile(
  nodes: GraphNode[],
  graph: CodeGraph,
  fileContent: string,
  language: string
): void {
  const functions = nodes.filter(n => n.type === 'function');
  
  for (const fn of functions) {
    // Find function calls in this function's body
    for (const otherFn of functions) {
      if (fn.id === otherFn.id) continue;
      
      // Simple check: does function body contain other function name?
      if (fn.content.includes(otherFn.name + '(')) {
        graph.addEdge({
          from: fn.id,
          to: otherFn.id,
          type: 'calls',
          metadata: { scope: 'local' },
        });
      }
    }
  }
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

  private getLanguage(ext: string): string | null {
    const map: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.py': 'python',
    };
    return map[ext] || null;
  }
}
