import { useState, useCallback } from 'react';
import type { Message } from '../app.js';

export interface UseChatState {
  messages: Message[];
  append: (message: Message) => void;
  reset: () => void;
}

export function useChat(initialMessages: Message[] = []): UseChatState {
  const [messages, setMessages] = useState<Message[]>(initialMessages);

  const append = useCallback((message: Message) => {
    setMessages(prev => [...prev, message]);
  }, []);

  const reset = useCallback(() => setMessages(initialMessages), [initialMessages]);

  return { messages, append, reset };
}
