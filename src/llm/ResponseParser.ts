export interface CodeBlock {
  language: string;
  content: string;
}

export interface ParsedResponse {
  raw: string;
  summary: string;
  codeBlocks: CodeBlock[];
  followUps: string[];
}

const CODE_BLOCK_REGEX = /```(\w+)?\n([\s\S]*?)```/g;

export class ResponseParser {
  parse(raw: string): ParsedResponse {
    const summary = this.extractSummary(raw);
    const codeBlocks = this.extractCodeBlocks(raw);
    const followUps = this.extractFollowUps(raw);

    return {
      raw,
      summary,
      codeBlocks,
      followUps,
    };
  }

  private extractSummary(raw: string): string {
    const firstLine = raw.trim().split('\n')[0] ?? '';
    return firstLine.length > 200 ? `${firstLine.slice(0, 197)}...` : firstLine;
  }

  private extractCodeBlocks(raw: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    let match: RegExpExecArray | null;

    while ((match = CODE_BLOCK_REGEX.exec(raw)) !== null) {
      const [, language = ''] = match;
      const content = match[2] ?? '';
      blocks.push({ language: language.trim().toLowerCase(), content: content.trim() });
    }

    return blocks;
  }

  private extractFollowUps(raw: string): string[] {
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(line => /^[-*]\s/.test(line))
      .map(line => line.replace(/^[-*]\s*/, '').trim());
  }
}
