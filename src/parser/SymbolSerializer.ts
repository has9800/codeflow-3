import type { ExtractedSymbol } from './SymbolExtractor.js';

export interface SymbolSerializationContext {
  filePath: string;
  language: string;
  imports: string[];
  referencedSymbols: string[];
}

export class SymbolSerializer {
  serialize(symbol: ExtractedSymbol, context: SymbolSerializationContext): string {
    const lines: string[] = [];

    lines.push(`# symbol ${symbol.type}:${symbol.kind ?? symbol.astType}`);
    lines.push(`name: ${symbol.name}`);
    lines.push(`signature: ${symbol.signature ?? symbol.name}`);
    lines.push(`file: ${context.filePath}`);
    lines.push(`language: ${context.language}`);

    if (symbol.exported) {
      lines.push('exported: true');
    }

    if (symbol.parentName) {
      lines.push(`parent: ${symbol.parentType ?? 'unknown'} ${symbol.parentName}`);
    }

    if (symbol.documentation && symbol.documentation.trim().length > 0) {
      lines.push('documentation:');
      lines.push(symbol.documentation.trim());
    }

    if (symbol.parameters && symbol.parameters.length > 0) {
      lines.push(`parameters: ${symbol.parameters.join(', ')}`);
    }

    if (symbol.returnType) {
      lines.push(`returns: ${symbol.returnType}`);
    }

    if (context.imports.length > 0) {
      lines.push(`imports: ${context.imports.join(', ')}`);
    }

    if (context.referencedSymbols.length > 0) {
      lines.push(`references: ${context.referencedSymbols.join(', ')}`);
    }

    lines.push('---');
    lines.push(symbol.content.trim());

    return lines.join('\n');
  }
}
