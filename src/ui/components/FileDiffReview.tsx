import React from 'react';
import { Box, Text } from 'ink';
import { FileEdit } from '../../files/FileApplier.js';

interface FileDiffReviewProps {
  edit: FileEdit;
  onApply: () => void;
  onSkip: () => void;
}

export function FileDiffReview({ edit, onApply, onSkip }: FileDiffReviewProps) {
  const preview = getPreview(edit);
  
  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} marginY={1}>
      <Box>
        <Text color="cyan" bold>┌─ {edit.path}</Text>
        <Text dimColor> ({edit.type})</Text>
      </Box>
      
      <Box flexDirection="column" paddingLeft={2} paddingY={1}>
        {preview.map((line, idx) => (
          <Text key={idx} color={getLineColor(line)}>
            {line}
          </Text>
        ))}
      </Box>
      
      <Box gap={2}>
        <Text color="green">→ Run this change</Text>
        <Text color="yellow">Skip</Text>
        <Text color="blue">Edit</Text>
      </Box>
    </Box>
  );
}

function getPreview(edit: FileEdit): string[] {
  if (edit.type === 'diff' && edit.diff) {
    return edit.diff.split('\n').slice(0, 10);
  } else if (edit.content) {
    return edit.content.split('\n').slice(0, 10);
  }
  return ['No preview available'];
}

function getLineColor(line: string): string {
  if (line.startsWith('+')) return 'green';
  if (line.startsWith('-')) return 'red';
  if (line.startsWith('@@')) return 'cyan';
  return 'white';
}
