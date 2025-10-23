import { z } from 'zod';
import { UserFacingError } from '../utils/errors.js';

const REQUIRED_SECTIONS = ['Code Style', 'Safety', 'Testing'];
const FORBIDDEN_PATTERNS = [/api\s*key/i, /password/i, /secret/i];

const SectionSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
});

export interface RuleSection extends z.infer<typeof SectionSchema> {}

export interface ValidatedRules {
  sections: RuleSection[];
  raw: string;
}

export class RulesValidator {
  static validate(content: string): ValidatedRules {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new UserFacingError('Rules file is empty.');
    }

    this.assertNoForbiddenPatterns(trimmed);
    const sections = this.parseSections(trimmed);
    this.assertRequiredSections(sections);

    return { sections, raw: trimmed };
  }

  private static parseSections(content: string): RuleSection[] {
    const chunks = content.split(/\n##\s+/).map((chunk, index) => {
      if (index === 0 && chunk.startsWith('# ')) {
        return chunk.slice(2); // remove leading title
      }
      return chunk;
    });

    const sections: RuleSection[] = [];

    for (const chunk of chunks) {
      const [titleLine, ...bodyLines] = chunk.split('\n');
      const title = titleLine.trim().replace(/^#+\s*/, '');
      const body = bodyLines.join('\n').trim();
      if (!title) continue;

      const parsed = SectionSchema.parse({ title, body });
      sections.push(parsed);
    }

    if (sections.length === 0) {
      throw new UserFacingError('No rule sections detected.');
    }

    return sections;
  }

  private static assertRequiredSections(sections: RuleSection[]): void {
    const titles = sections.map(section => section.title.toLowerCase());
    for (const required of REQUIRED_SECTIONS) {
      if (!titles.includes(required.toLowerCase())) {
        throw new UserFacingError(`Rules file is missing required section: ${required}`);
      }
    }
  }

  private static assertNoForbiddenPatterns(content: string): void {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        throw new UserFacingError('Rules file contains sensitive tokens. Remove secrets before proceeding.');
      }
    }
  }
}
