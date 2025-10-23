import { useInput } from 'ink';
import type { Key } from 'ink';

export type KeyboardHandler = (input: string, key: Key) => void;

export function useKeyboard(handler: KeyboardHandler): void {
  useInput((input, key) => {
    handler(input, key);
  });
}
