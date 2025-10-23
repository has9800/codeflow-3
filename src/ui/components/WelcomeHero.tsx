import React from 'react';
import { Box, Text } from 'ink';

interface WelcomeHeroProps {
  model: string;
  accountLabel?: string;
  offline?: boolean;
}

export function WelcomeHero({ model, accountLabel, offline }: WelcomeHeroProps) {
  return (
    <Box
      flexDirection="column"
      alignItems="center"
      borderStyle="round"
      borderColor="cyan"
      paddingX={4}
      paddingY={2}
      marginY={1}
      width="100%"
    >
      <Text color="cyan" bold>
        ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
      </Text>
      <Text color="cyan" bold>
          ┃      CodeFlow • Dependency-Aware Coding    ┃
      </Text>
      <Text color="cyan" bold>
        ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
      </Text>

      <Box marginTop={1} flexDirection="column" alignItems="center">
        <Text>
          <Text bold color="green">
            Session ready
          </Text>{' '}
          • Model:{' '}
          <Text color="magenta" bold>
            {model}
          </Text>
        </Text>
        <Text>
          Account:{' '}
          <Text color={offline ? 'yellow' : 'cyan'}>
            {offline ? 'Offline mode' : accountLabel && accountLabel.length > 0 ? accountLabel : 'Not authenticated'}
          </Text>
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column" width="100%">
        <Text dimColor>Tips:</Text>
        <Text>
          {'  '}• Use <Text bold color="white">/file path/to/file.ts</Text> to set the focus file.
        </Text>
        <Text>
          {'  '}• Ask for a plan, refactor, or new feature — CodeFlow pulls only the relevant context.
        </Text>
        <Text>
          {'  '}• Apply generated edits directly, or review them first in the change panel.
        </Text>
        <Text>
          {'  '}• Graph storage is ephemeral — sessions auto-destroy the database on logout.
        </Text>
        <Text>
          {'  '}• Need to keep context longer? Set retention up to 90 days, then purge anytime with `codeflow logout`.
        </Text>
      </Box>
    </Box>
  );
}
