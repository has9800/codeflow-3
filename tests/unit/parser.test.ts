import { describe, it, expect } from 'vitest';
import { languageRegistry } from '../../src/parser/LanguageRegistry.js';
import { TreeSitterParser } from '../../src/parser/TreeSitterParser.js';
import { SymbolExtractor } from '../../src/parser/SymbolExtractor.js';

describe('LanguageRegistry', () => {
  it('infers language from file extension', () => {
    expect(languageRegistry.inferFromPath('index.ts')).toBe('typescript');
    expect(languageRegistry.inferFromPath('component.tsx')).toBe('tsx');
    expect(languageRegistry.inferFromPath('unknown.file')).toBeNull();
  });
});

describe('SymbolExtractor', () => {
  it('extracts functions and classes', async () => {
    const parser = new TreeSitterParser();
    const extractor = new SymbolExtractor();
    const source = `
      export class Greeter {
        greet() { return 'hi'; }
      }

      export function sayHello() {
        return 'hello';
      }
    `;

    const tree = await parser.parse(source, 'typescript');
    const symbols = extractor.extractSymbols(tree, 'typescript');

    const names = symbols.map(symbol => symbol.name);
    expect(names).toContain('Greeter');
    expect(names).toContain('sayHello');
  });
});
