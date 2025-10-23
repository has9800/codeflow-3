import { describe, it, expect, beforeAll } from 'vitest';
import { FileApplier } from '../../src/files/FileApplier.js';
import { TreeSitterParser } from '../../src/parser/TreeSitterParser.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Code Quality Validation', () => {
  let testDir: string;
  let applier: FileApplier;
  let parser: TreeSitterParser;

  beforeAll(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeflow-test-'));
    applier = new FileApplier(testDir);
    parser = new TreeSitterParser();
  });

  it('should reject syntactically invalid TypeScript', async () => {
    const invalidCode = `
      function test() {
        const x = ;  // Syntax error
        return x
      }
    `;

    const testFile = path.join(testDir, 'invalid.ts');
    await fs.writeFile(testFile, 'const y = 1;', 'utf-8');

    const result = await applier.apply({
      type: 'replace',
      path: 'invalid.ts',
      content: invalidCode,
    });

    expect(result.syntaxValid).toBe(false);
  });

  it('should accept valid TypeScript', async () => {
    const validCode = `
      function test(): number {
        const x = 42;
        return x;
      }
    `;

    const testFile = path.join(testDir, 'valid.ts');
    await fs.writeFile(testFile, 'const y = 1;', 'utf-8');

    const result = await applier.apply({
      type: 'replace',
      path: 'valid.ts',
      content: validCode,
    });

    expect(result.success).toBe(true);
    expect(result.syntaxValid).toBe(true);
  });

  it('should validate function structure', async () => {
    const code = `
      export function calculateSum(a: number, b: number): number {
        return a + b;
      }
    `;

    const tree = await parser.parse(code, 'typescript');
    expect(tree.rootNode.hasError).toBe(false);

    // Check that function declaration exists
    const [functionNode] = tree.rootNode.descendantsOfType('function_declaration');
    expect(functionNode).toBeDefined();
    expect(functionNode?.childForFieldName('name')?.text).toBe('calculateSum');
  });

  it('should detect missing return statements', async () => {
    const code = `
      function shouldReturn(): number {
        const x = 42;
        // Missing return
      }
    `;

    const tree = await parser.parse(code, 'typescript');
    // Tree-sitter won't catch this semantic error, but we can check structure
    const [functionNode] = tree.rootNode.descendantsOfType('function_declaration');
    const body = functionNode?.childForFieldName('body');
    const returnStatements = body?.descendantsOfType('return_statement');
    
    expect(returnStatements?.length).toBe(0); // No return statement found
  });

  it('should validate import statements', async () => {
    const code = `
      import { CodeGraph } from './CodeGraph';
      import * as fs from 'fs';
      import Parser from 'tree-sitter';
    `;

    const tree = await parser.parse(code, 'typescript');
    const imports = tree.rootNode.descendantsOfType('import_statement');
    
    expect(imports.length).toBe(3);
    expect(tree.rootNode.hasError).toBe(false);
  });
});
