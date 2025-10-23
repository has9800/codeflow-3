import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

interface StatusIndicatorProps {
  text: string;
}

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function StatusIndicator({ text }: StatusIndicatorProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(prev => (prev + 1) % spinnerFrames.length);
    }, 80);

    return () => clearInterval(timer);
  }, []);

  return (
    <Text color="cyan">
      {spinnerFrames[frame]} {text}
    </Text>
  );
}
