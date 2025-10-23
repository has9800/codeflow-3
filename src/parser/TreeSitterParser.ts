import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import JavaScript from 'tree-sitter-javascript';
import Python from 'tree-sitter-python';

export class TreeSitterParser {
  private parsers: Map<string, Parser> = new Map();

  constructor() {
    this.initializeParsers();
  }

  private initializeParsers(): void {
    // TypeScript
    const tsParser = new Parser();
    tsParser.setLanguage(TypeScript.typescript);
    this.parsers.set('typescript', tsParser);

    // TSX
    const tsxParser = new Parser();
    tsxParser.setLanguage(TypeScript.tsx);
    this.parsers.set('tsx', tsxParser);

    // JavaScript
    const jsParser = new Parser();
    jsParser.setLanguage(JavaScript);
    this.parsers.set('javascript', jsParser);
    this.parsers.set('jsx', jsParser);

    // Python
    const pyParser = new Parser();
    pyParser.setLanguage(Python);
    this.parsers.set('python', pyParser);
  }

  async parse(content: string, language: string): Promise<Parser.Tree> {
    const parser = this.parsers.get(language);
    
    if (!parser) {
      throw new Error(`Unsupported language: ${language}`);
    }

    return parser.parse(content);
  }

  async parseIncremental(
    content: string,
    language: string,
    oldTree: Parser.Tree,
    edit: Parser.Edit
  ): Promise<Parser.Tree> {
    const parser = this.parsers.get(language);
    
    if (!parser) {
      throw new Error(`Unsupported language: ${language}`);
    }

    oldTree.edit(edit);
    return parser.parse(content, oldTree);
  }
}
