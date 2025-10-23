export class TokenCounter {
  count(text: string): number {
    // Simple approximation: ~4 characters per token
    // For production, could use tiktoken or similar
    return Math.ceil(text.length / 4);
  }

  countMessages(messages: Array<{ content: string }>): number {
    return messages.reduce((sum, msg) => sum + this.count(msg.content), 0);
  }
}
