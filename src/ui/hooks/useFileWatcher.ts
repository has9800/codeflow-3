import { useEffect, useRef } from 'react';
import fs from 'fs';

type Watcher = fs.FSWatcher;

export function useFileWatcher(filePaths: string[], onChange: (path: string) => void): void {
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;

  useEffect(() => {
    const watchers: Watcher[] = [];
    const uniquePaths = Array.from(new Set(filePaths)).filter(Boolean);

    for (const path of uniquePaths) {
      try {
        const watcher = fs.watch(path, () => callbackRef.current(path));
        watchers.push(watcher);
      } catch {
        // ignore missing files/directories
      }
    }

    return () => {
      for (const watcher of watchers) {
        watcher.close();
      }
    };
  }, [JSON.stringify(filePaths)]);
}
