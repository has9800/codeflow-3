import type Parser from 'tree-sitter';
import { TreeSitterParser } from '../parser/TreeSitterParser.js';
import { languageRegistry } from '../parser/LanguageRegistry.js';

export interface SyntaxCheckResult {
  valid: boolean;
  errors: string[];
}

export class SyntaxValidator {
  constructor(private readonly parser: TreeSitterParser = new TreeSitterParser()) {}

  async validate(content: string, filePath: string): Promise<SyntaxCheckResult> {
    const language = languageRegistry.inferFromPath(filePath);
    if (!language) {
      return { valid: true, errors: [] };
    }

    try {
      const tree = await this.parser.parse(content, language);
      if (!tree.rootNode.hasError) {
        return { valid: true, errors: [] };
      }

      const errors: string[] = [];
      this.collectErrors(tree.rootNode, errors);
      return { valid: false, errors };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  private collectErrors(node: Parser.SyntaxNode, errors: string[]): void {
    const hasError = typeof (node as any).hasError === 'function'
      ? (node as any).hasError()
      : Boolean((node as any).hasError);

    if (hasError) {
      if (node.type === 'ERROR') {
        errors.push(
          `Syntax error near line ${node.startPosition.row + 1}, column ${node.startPosition.column + 1}`
        );
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) this.collectErrors(child, errors);
      }
    }
  }
}
