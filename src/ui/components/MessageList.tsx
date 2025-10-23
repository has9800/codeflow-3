import React from 'react';
import { Box, Text } from 'ink';
import type { Message } from '../app.js';

interface MessageListProps {
  messages: Message[];
  streaming: boolean;
}

export function MessageList({ messages, streaming }: MessageListProps) {
  return (
    <Box flexDirection="column">
      {messages.map(msg => (
        <Box key={msg.id} flexDirection="column" marginY={1}>
          <Box>
            <Text bold color={msg.role === 'user' ? 'blue' : 'green'}>
              {msg.role === 'user' ? 'You' : 'Assistant'}:
            </Text>
          </Box>
          <Box paddingLeft={2}>
            <Text>{msg.content}</Text>
          </Box>
        </Box>
      ))}
      {streaming && (
        <Box>
          <Text dimColor>…</Text>
        </Box>
      )}
    </Box>
  );
}
