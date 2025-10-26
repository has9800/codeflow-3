import Parser from 'tree-sitter';

export interface ExtractedSymbol {
  type: 'function' | 'class' | 'import';
  name: string;
  content: string;
  startLine: number;
  endLine: number;
  startIndex: number;
  endIndex: number;
  exported: boolean;
  kind?: string;
  astType: string;
  parentName?: string;
  parentType?: ExtractedSymbol['type'];
  documentation?: string;
  parameters?: string[];
  returnType?: string;
  signature?: string;
}

export type ReferenceKind = 'call' | 'extends' | 'implements';

export interface SymbolReference {
  kind: ReferenceKind;
  sourceStartIndex: number;
  sourceEndIndex: number;
  targetName: string;
  targetModule?: string;
}

export interface SymbolGraphData {
  symbols: ExtractedSymbol[];
  references: SymbolReference[];
}

export class SymbolExtractor {
  extractGraphData(tree: Parser.Tree, language: string): SymbolGraphData {
    const symbols: ExtractedSymbol[] = [];
    const references: SymbolReference[] = [];
    const stack: ExtractedSymbol[] = [];

    const visit = (node: Parser.SyntaxNode) => {
      let createdSymbol: ExtractedSymbol | null = null;

      if (this.isFunctionNode(node, language)) {
        createdSymbol = this.extractFunction(node, stack.at(-1) ?? null);
      } else if (this.isClassNode(node, language)) {
        createdSymbol = this.extractClass(node, stack.at(-1) ?? null);
        this.extractInheritanceReferences(node, language).forEach(ref => references.push(ref));
      } else if (this.isImportNode(node, language)) {
        createdSymbol = this.extractImport(node);
      }

      if (createdSymbol) {
        symbols.push(createdSymbol);
        stack.push(createdSymbol);
      }

      if (stack.length > 0 && this.isCallExpression(node, language)) {
        const targetName = this.extractCallTarget(node, language);
        if (targetName) {
          const current = stack[stack.length - 1];
          references.push({
            kind: 'call',
            sourceStartIndex: current.startIndex,
            sourceEndIndex: current.endIndex,
            targetName,
          });
        }
      }

      for (let i = 0; i < node.namedChildCount; i += 1) {
        visit(node.namedChild(i)!);
      }

      if (createdSymbol) {
        stack.pop();
      }
    };

    visit(tree.rootNode);
    return { symbols, references };
  }

  extractSymbols(tree: Parser.Tree, language: string): ExtractedSymbol[] {
    return this.extractGraphData(tree, language).symbols;
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

  private isCallExpression(node: Parser.SyntaxNode, language: string): boolean {
    const callTypes = {
      typescript: ['call_expression', 'new_expression'],
      javascript: ['call_expression', 'new_expression'],
      python: ['call'],
    };

    return callTypes[language as keyof typeof callTypes]?.includes(node.type) || false;
  }

  private extractFunction(node: Parser.SyntaxNode, parent: ExtractedSymbol | null): ExtractedSymbol {
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text || 'anonymous';

    const kind =
      node.type === 'method_definition'
        ? 'method'
        : node.type === 'arrow_function'
        ? 'arrow_function'
        : node.type;

    const parameters = this.extractParameters(node);
    const signature =
      kind === 'arrow_function' && !nameNode
        ? `anonymous(${parameters.join(', ')})`
        : `${name}(${parameters.join(', ')})`;

    return {
      type: 'function',
      name,
      content: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      exported: this.isExported(node),
      kind,
      astType: node.type,
      parentName: parent?.name,
      parentType: parent?.type,
      documentation: this.extractDocumentation(node),
      parameters,
      signature,
    };
  }

  private extractClass(node: Parser.SyntaxNode, parent: ExtractedSymbol | null): ExtractedSymbol {
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text || 'Anonymous';

    return {
      type: 'class',
      name,
      content: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      exported: this.isExported(node),
      kind: node.type,
      astType: node.type,
      parentName: parent?.name,
      parentType: parent?.type,
      documentation: this.extractDocumentation(node),
      signature: `class ${name}`,
    };
  }

  private extractImport(node: Parser.SyntaxNode): ExtractedSymbol {
    return {
      type: 'import',
      name: node.text,
      content: node.text,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      exported: false,
      kind: node.type,
      astType: node.type,
      signature: node.text,
    };
  }

  private isExported(node: Parser.SyntaxNode): boolean {
    let current: Parser.SyntaxNode | null = node;
    while (current) {
      if (current.type === 'export_statement' || current.type === 'export_clause') {
        return true;
      }
      if (current.type === 'program' || current.type === 'module') {
        break;
      }
      current = current.parent;
    }
    return false;
  }

  private extractParameters(node: Parser.SyntaxNode): string[] {
    const paramsNode =
      node.childForFieldName('parameters') ?? node.childForFieldName('parameter_list');
    if (!paramsNode) {
      return [];
    }

    const raw = paramsNode.text.replace(/^\(|\)$/g, '');
    if (raw.trim().length === 0) {
      return [];
    }

    return raw
      .split(',')
      .map(param => param.trim())
      .filter(Boolean)
      .map(param => param.split(':')[0]?.trim() ?? param);
  }

  private getPrevSibling(node: Parser.SyntaxNode | null): Parser.SyntaxNode | null {
    if (!node) {
      return null;
    }
    const candidate = (node as unknown as { prevSibling?: Parser.SyntaxNode | null }).prevSibling;
    return candidate ?? null;
  }

  private extractDocumentation(node: Parser.SyntaxNode): string | undefined {
    let current: Parser.SyntaxNode | null = this.getPrevSibling(node);
    const docs: string[] = [];

    while (current && current.type === 'comment') {
      docs.unshift(current.text.replace(/^\/\*\*?|\*\/$/g, '').trim());
      current = this.getPrevSibling(current);
    }

    const documentation = docs.join('\n').trim();
    return documentation.length > 0 ? documentation : undefined;
  }

  private extractCallTarget(node: Parser.SyntaxNode, language: string): string | null {
    if (node.type === 'call_expression' || node.type === 'new_expression') {
      const callee =
        node.childForFieldName('function') ??
        node.child(0);
      return this.resolveIdentifier(callee);
    }

    if (language === 'python' && node.type === 'call') {
      const callee = node.childForFieldName('function') ?? node.child(0);
      return this.resolveIdentifier(callee);
    }

    return null;
  }

  private resolveIdentifier(node: Parser.SyntaxNode | null): string | null {
    if (!node) {
      return null;
    }

    if (node.type === 'identifier') {
      return node.text;
    }

    if (node.type === 'member_expression' || node.type === 'attribute') {
      const property =
        node.childForFieldName('property') ??
        node.child(node.namedChildCount - 1) ??
        node.lastChild;
      return property ? property.text : null;
    }

    if (node.type === 'scoped_identifier') {
      return node.child(node.namedChildCount - 1)?.text ?? null;
    }

    if (node.type === 'call_expression') {
      return this.resolveIdentifier(
        node.childForFieldName('function') ?? node.child(0)
      );
    }

    return null;
  }

  private extractInheritanceReferences(
    node: Parser.SyntaxNode,
    language: string
  ): SymbolReference[] {
    const references: SymbolReference[] = [];
    const text = node.text;

    if (language === 'typescript' || language === 'javascript') {
      const extendsMatch = text.match(/extends\s+([A-Za-z0-9_]+)/);
      if (extendsMatch) {
        references.push({
          kind: 'extends',
          sourceStartIndex: node.startIndex,
          sourceEndIndex: node.endIndex,
          targetName: extendsMatch[1],
        });
      }

      const implementsMatch = text.match(/implements\s+([A-Za-z0-9_,\s]+)/);
      if (implementsMatch) {
        implementsMatch[1]
          .split(',')
          .map(name => name.trim())
          .filter(Boolean)
          .forEach(name => {
            references.push({
              kind: 'implements',
              sourceStartIndex: node.startIndex,
              sourceEndIndex: node.endIndex,
              targetName: name,
            });
          });
      }
    }

    if (language === 'python') {
      const extendsMatch = text.match(/\(([^)]+)\)/);
      if (extendsMatch) {
        extendsMatch[1]
          .split(',')
          .map(name => name.trim())
          .filter(Boolean)
          .forEach(name => {
            references.push({
              kind: 'extends',
              sourceStartIndex: node.startIndex,
              sourceEndIndex: node.endIndex,
              targetName: name,
            });
          });
      }
    }

    return references;
  }
}
