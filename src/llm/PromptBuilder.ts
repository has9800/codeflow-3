import type { Message } from './OpenRouterClient.js';

const DEFAULT_SYSTEM_PROMPT = `You are CodeFlow, a senior software engineer embedded in the user's terminal. Provide concise, actionable help, avoid speculative changes, and respect project rules.`;

export interface PromptPayload {
  userMessage: string;
  dependencyContext?: string;
  rules?: string;
  conversation?: Message[];
  metadata?: Record<string, string>;
}

export class PromptBuilder {
  constructor(private readonly baseSystemPrompt: string = DEFAULT_SYSTEM_PROMPT) {}

  build(payload: PromptPayload): Message[] {
    const messages: Message[] = [];

    messages.push(this.buildSystemMessage(payload));

    if (payload.dependencyContext) {
      messages.push({
        role: 'user',
        content: payload.dependencyContext,
        cache_control: { type: 'ephemeral' },
      });
    }

    if (payload.conversation?.length) {
      messages.push(
        ...payload.conversation.filter(msg => msg.role !== 'system')
      );
    }

    messages.push({
      role: 'user',
      content: payload.userMessage,
    });

    return messages;
  }

  private buildSystemMessage(payload: PromptPayload): Message {
    const sections: string[] = [this.baseSystemPrompt];
    if (payload.rules) {
      sections.push(payload.rules.trim());
    }
    if (payload.metadata && Object.keys(payload.metadata).length > 0) {
      const meta = Object.entries(payload.metadata)
        .map(([key, value]) => `- ${key}: ${value}`)
        .join('\n');
      sections.push(`# Session Metadata\n${meta}`);
    }

    return {
      role: 'system',
      content: sections.join('\n\n'),
      cache_control: { type: 'ephemeral' },
    };
  }
}
