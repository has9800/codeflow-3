import * as fs from 'fs/promises';
import * as path from 'path';
import { RulesValidator } from './RulesValidator.js';

export class RulesLoader {
  private ruleFiles = ['.codeflowrules', '.cursorrules', '.aicoderules'];

  constructor(private rootDir: string) {}

  async load(): Promise<string> {
    for (const fileName of this.ruleFiles) {
      const filePath = path.join(this.rootDir, fileName);
      
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return RulesValidator.validate(content).raw;
      } catch {
        // File doesn't exist, try next
        continue;
      }
    }

    // Return default rules if no file found
    return this.getDefaultRules();
  }

  private getDefaultRules(): string {
    return `# Project Rules

## Code Style
- Write clean, readable code
- Add comments for complex logic
- Follow language best practices

## Safety
- Never expose secrets or API keys
- Validate all user input
- Handle errors gracefully

## Testing
- Add tests for new features
- Ensure existing tests pass
`;
  }

  async save(content: string, fileName: string = '.codeflowrules'): Promise<void> {
    const filePath = path.join(this.rootDir, fileName);
    await fs.writeFile(filePath, content, 'utf-8');
  }
}
