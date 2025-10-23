import React from 'react';
import { Box, Text } from 'ink';
import type { Message } from '../app.js';

interface MessageListProps {
  messages: Message[];
  streaming: boolean;
  assistantLabel?: string;
  maxVisibleMessages?: number;
}

export function MessageList({
  messages,
  streaming,
  assistantLabel = 'Assistant',
  maxVisibleMessages = 120,
}: MessageListProps) {
  const visibleMessages =
    messages.length > maxVisibleMessages
      ? messages.slice(messages.length - maxVisibleMessages)
      : messages;

  return (
    <Box flexDirection="column" gap={0}>
      {visibleMessages.map((msg) => {
        const isUser = msg.role === 'user';
        const borderColor = isUser ? 'blue' : 'green';
        const labelColor = isUser ? 'blue' : 'green';

        return (
          <Box
            key={msg.id}
            width="100%"
            justifyContent={isUser ? 'flex-end' : 'flex-start'}
            marginY={0}
          >
            <Box flexDirection="column" alignItems={isUser ? 'flex-end' : 'flex-start'}>
              <Text dimColor>
                <Text color={labelColor} bold>
                  {isUser ? 'You' : assistantLabel}
                </Text>
              </Text>
              <Box borderStyle="round" borderColor={borderColor} paddingX={1} paddingY={0} marginTop={0}>
                <Text>{msg.content}</Text>
              </Box>
            </Box>
          </Box>
        );
      })}
      {streaming && (
        <Box>
          <Text dimColor>…</Text>
        </Box>
      )}
    </Box>
  );
}
