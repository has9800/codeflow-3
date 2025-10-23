import Parser from 'tree-sitter';
import { GraphNode } from '../graph/CodeGraph.js';

export interface ExtractedSymbol {
  type: 'function' | 'class' | 'import';
  name: string;
  content: string;
  startLine: number;
  endLine: number;
}

export class SymbolExtractor {
  extractSymbols(tree: Parser.Tree, language: string): ExtractedSymbol[] {
    const symbols: ExtractedSymbol[] = [];

    const walk = (node: Parser.SyntaxNode) => {
      // Extract based on node type
      if (this.isFunctionNode(node, language)) {
        symbols.push(this.extractFunction(node));
      } else if (this.isClassNode(node, language)) {
        symbols.push(this.extractClass(node));
      } else if (this.isImportNode(node, language)) {
        symbols.push(this.extractImport(node));
      }

      // Recurse into children
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i)!);
      }
    };

    walk(tree.rootNode);
    return symbols;
  }

  private isFunctionNode(node: Parser.SyntaxNode, language: string): boolean {
    const functionTypes = {
      typescript: ['function_declaration', 'method_definition', 'arrow_function'],
      javascript: ['function_declaration', 'function_expression', 'arrow_function'],
      python: ['function_definition'],
    };

    return functionTypes[language as keyof typeof functionTypes]?.includes(node.type) || false;
  }

  private isClassNode(node: Parser.SyntaxNode, language: string): boolean {
    const classTypes = {
      typescript: ['class_declaration'],
      javascript: ['class_declaration'],
      python: ['class_definition'],
    };

    return classTypes[language as keyof typeof classTypes]?.includes(node.type) || false;
  }

  private isImportNode(node: Parser.SyntaxNode, language: string): boolean {
    const importTypes = {
      typescript: ['import_statement'],
      javascript: ['import_statement'],
      python: ['import_statement', 'import_from_statement'],
    };

    return importTypes[language as keyof typeof importTypes]?.includes(node.type) || false;
  }

  private extractFunction(node: Parser.SyntaxNode): ExtractedSymbol {
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text || 'anonymous';

    return {
      type: 'function',
      name,
      content: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  private extractClass(node: Parser.SyntaxNode): ExtractedSymbol {
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text || 'Anonymous';

    return {
      type: 'class',
      name,
      content: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }

  private extractImport(node: Parser.SyntaxNode): ExtractedSymbol {
    return {
      type: 'import',
      name: node.text,
      content: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    };
  }
}
