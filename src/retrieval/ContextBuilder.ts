import { GraphNode } from '../graph/CodeGraph.js';

export class ContextBuilder {
  build(nodes: GraphNode[], maxTokens: number): string {
    const sections: string[] = [];
    let currentTokens = 0;

    for (const node of nodes) {
      const section = this.formatNode(node);
      const sectionTokens = this.estimateTokens(section);

      if (currentTokens + sectionTokens > maxTokens) {
        break;
      }

      sections.push(section);
      currentTokens += sectionTokens;
    }

    return sections.join('\n\n---\n\n');
  }

  private formatNode(node: GraphNode): string {
    return `File: ${node.path}\nLines: ${node.startLine}-${node.endLine}\n\n\`\`\`\n${node.content}\n\`\`\``;
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
}
