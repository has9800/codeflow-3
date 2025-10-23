import React from 'react';
import { Box, Text } from 'ink';
interface HeaderProps {
  model: string;
  tokensSaved: number;
  savingsPercent: number;
  status: string;
  accountLabel?: string;
  offline?: boolean;
  variant?: 'default' | 'footer';
}

export function Header({
  model,
  tokensSaved,
  savingsPercent,
  status,
  accountLabel,
  offline,
  variant = 'default',
}: HeaderProps) {
  const accountDisplay = offline
    ? 'Offline'
    : accountLabel && accountLabel.length > 0
    ? accountLabel
    : 'Not logged in';

  if (variant === 'footer') {
    return (
      <Box
        width="100%"
        paddingX={1}
        paddingY={0}
        borderStyle="single"
        borderColor="gray"
        justifyContent="space-between"
        alignItems="center"
      >
        <Box>
          <Text dimColor>Model: </Text>
          <Text color="cyan">{model}</Text>
          <Text dimColor> • Account: </Text>
          <Text color="magenta">{accountDisplay}</Text>
        </Box>
        <Box>
          <Text dimColor>Status: </Text>
          <Text>{status}</Text>
          <Text dimColor> • Tokens saved: </Text>
          <Text color="green" bold>{tokensSaved.toLocaleString()}</Text>
          <Text color="green"> ({savingsPercent}%)</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box borderStyle="single" paddingX={1}>
      <Box flexGrow={1}>
        <Text color="cyan" bold>CodeFlow</Text>
        <Text dimColor> - {model}</Text>
      </Box>
      <Box marginRight={2}>
        <Text dimColor>Account: </Text>
        <Text color="magenta">{accountDisplay}</Text>
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
