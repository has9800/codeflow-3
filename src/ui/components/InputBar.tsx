import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

interface InputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled: boolean;
  placeholder: string;
}

export function InputBar({ value, onChange, onSubmit, disabled, placeholder }: InputBarProps) {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text color="cyan">{'> '}</Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={placeholder}
        showCursor={!disabled}
      />
    </Box>
  );
}
