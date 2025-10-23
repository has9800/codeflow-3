import type { ChatChunk } from './OpenRouterClient.js';

export interface StreamHandlerOptions {
  onToken?: (token: string) => void;
  onUsage?: (usage: { total: number; prompt: number; completion: number }) => void;
  onComplete?: (full: string) => void;
  onError?: (error: unknown) => void;
}

export class StreamHandler {
  async consume(stream: AsyncIterable<ChatChunk>, options: StreamHandlerOptions = {}): Promise<string> {
    let buffer = '';

    try {
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content ?? '';
        if (token) {
          buffer += token;
          options.onToken?.(token);
        }

        const usage = chunk.usage;
        if (usage) {
          options.onUsage?.({
            total: usage.total_tokens ?? 0,
            prompt: usage.prompt_tokens ?? 0,
            completion: usage.completion_tokens ?? 0,
          });
        }
      }

      options.onComplete?.(buffer);
      return buffer;
    } catch (error) {
      options.onError?.(error);
      throw error;
    }
  }
}
