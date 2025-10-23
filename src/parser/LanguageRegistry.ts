export type SupportedLanguage =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'python'
  | 'json'
  | 'markdown';

interface LanguageInfo {
  id: SupportedLanguage;
  displayName: string;
  extensions: string[];
}

const DEFAULT_LANGUAGES: LanguageInfo[] = [
  { id: 'typescript', displayName: 'TypeScript', extensions: ['.ts'] },
  { id: 'tsx', displayName: 'TypeScript JSX', extensions: ['.tsx'] },
  { id: 'javascript', displayName: 'JavaScript', extensions: ['.js', '.mjs', '.cjs'] },
  { id: 'jsx', displayName: 'JavaScript JSX', extensions: ['.jsx'] },
  { id: 'python', displayName: 'Python', extensions: ['.py'] },
  { id: 'json', displayName: 'JSON', extensions: ['.json'] },
  { id: 'markdown', displayName: 'Markdown', extensions: ['.md', '.markdown'] },
];

export class LanguageRegistry {
  private static instance: LanguageRegistry | null = null;
  private readonly languages = new Map<SupportedLanguage, LanguageInfo>();
  private readonly extensions = new Map<string, SupportedLanguage>();

  private constructor() {
    DEFAULT_LANGUAGES.forEach(info => this.register(info));
  }

  static getInstance(): LanguageRegistry {
    if (!this.instance) {
      this.instance = new LanguageRegistry();
    }
    return this.instance;
  }

  register(info: LanguageInfo): void {
    this.languages.set(info.id, info);
    for (const ext of info.extensions) {
      this.extensions.set(ext.toLowerCase(), info.id);
    }
  }

  inferFromPath(filePath: string): SupportedLanguage | null {
    const dotIndex = filePath.lastIndexOf('.');
    if (dotIndex === -1) {
      return null;
    }
    const ext = filePath.slice(dotIndex).toLowerCase();
    return this.extensions.get(ext) ?? null;
  }

  getLanguageInfo(id: SupportedLanguage): LanguageInfo | undefined {
    return this.languages.get(id);
  }

  list(): LanguageInfo[] {
    return Array.from(this.languages.values());
  }
}

export const languageRegistry = LanguageRegistry.getInstance();
