export type LangGraphTraceStatus = 'ok' | 'error';

export interface LangGraphTraceEntry {
  node: string;
  startedAt: string;
  durationMs: number;
  status: LangGraphTraceStatus;
  metadata?: Record<string, unknown>;
  error?: string;
}

export class LangGraphTrace {
  private readonly entries: LangGraphTraceEntry[] = [];

  async record<T>(
    node: string,
    fn: () => Promise<T>,
    metadata?: (result: T) => Record<string, unknown>
  ): Promise<T> {
    const started = Date.now();
    try {
      const result = await fn();
      this.entries.push({
        node,
        startedAt: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        status: 'ok',
        metadata: metadata ? metadata(result) : undefined,
      });
      return result;
    } catch (error) {
      this.entries.push({
        node,
        startedAt: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  getEntries(): LangGraphTraceEntry[] {
    return [...this.entries];
  }

  toJSON(): LangGraphTraceEntry[] {
    return this.getEntries();
  }
}
