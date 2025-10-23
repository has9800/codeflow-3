import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface UsageEvent {
  timestamp: number;
  tokensUsed: number;
  tokensSaved: number;
  model: string;
  searchType: string;
}

export class UsageTracker {
  private logPath: string;

  constructor() {
    this.logPath = path.join(os.homedir(), '.codeflow', 'usage.jsonl');
  }

  async track(event: Omit<UsageEvent, 'timestamp'>): Promise<void> {
    const fullEvent: UsageEvent = {
      ...event,
      timestamp: Date.now(),
    };

    const line = JSON.stringify(fullEvent) + '\n';

    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    await fs.appendFile(this.logPath, line, 'utf-8');
  }

  async getStats(since?: number): Promise<{
    totalTokensUsed: number;
    totalTokensSaved: number;
    savingsPercent: number;
    eventCount: number;
  }> {
    try {
      const content = await fs.readFile(this.logPath, 'utf-8');
      const lines = content.trim().split('\n');
      
      let totalTokensUsed = 0;
      let totalTokensSaved = 0;
      let eventCount = 0;

      for (const line of lines) {
        const event: UsageEvent = JSON.parse(line);
        
        if (since && event.timestamp < since) continue;
        
        totalTokensUsed += event.tokensUsed;
        totalTokensSaved += event.tokensSaved;
        eventCount++;
      }

      const savingsPercent = totalTokensUsed > 0
        ? (totalTokensSaved / (totalTokensUsed + totalTokensSaved)) * 100
        : 0;

      return {
        totalTokensUsed,
        totalTokensSaved,
        savingsPercent,
        eventCount,
      };
    } catch {
      return {
        totalTokensUsed: 0,
        totalTokensSaved: 0,
        savingsPercent: 0,
        eventCount: 0,
      };
    }
  }
}
