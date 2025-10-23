import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

interface HeaderProps {
  model: string;
  tokensSaved: number;
  savingsPercent: number;
  status: string;
}

export function Header({ model, tokensSaved, savingsPercent, status }: HeaderProps) {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Box flexGrow={1}>
        <Text color="cyan" bold>CodeFlow</Text>
        <Text dimColor> - {model}</Text>
      </Box>
      <Box>
        <Text dimColor>Status: </Text>
        <Text>{status}</Text>
      </Box>
      <Box marginLeft={2}>
        <Text dimColor>Tokens saved: </Text>
        <Text color="green" bold>{tokensSaved.toLocaleString()}</Text>
        <Text color="green"> ({savingsPercent}%)</Text>
      </Box>
    </Box>
  );
}
