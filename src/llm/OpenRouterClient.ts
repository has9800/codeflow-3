import { EventEmitter } from 'events';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  cache_control?: { type: 'ephemeral' };
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatChunk {
  id: string;
  choices: Array<{
    delta: { content?: string; role?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenRouterClient extends EventEmitter {
  private baseUrl = 'https://openrouter.ai/api/v1';
  
  constructor(private apiKey: string, private appName: string = 'CodeFlow CLI') {
    super();
  }

  async chat(request: ChatRequest): Promise<AsyncIterable<ChatChunk>> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://codeflow.dev',
        'X-Title': this.appName,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...request,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    return this.parseSSE(response);
  }

  private async *parseSSE(response: Response): AsyncIterable<ChatChunk> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || line.startsWith(':')) continue;
          
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;

            try {
              const chunk: ChatChunk = JSON.parse(data);
              yield chunk;
            } catch (e) {
              console.error('Failed to parse SSE chunk:', e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(): Promise<Array<{ id: string; name: string }>> {
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to list models: ${response.status}`);
    }

    const data = await response.json();
    return data.data || [];
  }
}
