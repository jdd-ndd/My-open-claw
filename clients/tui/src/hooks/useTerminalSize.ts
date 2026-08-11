/**
 * 终端尺寸 Hook
 * 监听 process.stdout 'resize' 事件,实时返回当前 columns/rows
 */

import { useEffect, useState } from 'react';

export interface TerminalSize {
  columns: number;
  rows: number;
}

export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(() => ({
    columns: process.stdout.columns ?? 120,
    rows: process.stdout.rows ?? 40,
  }));

  useEffect(() => {
    const onResize = () => {
      setSize({
        columns: process.stdout.columns ?? 120,
        rows: process.stdout.rows ?? 40,
      });
    };
    process.stdout.on('resize', onResize);
    return () => {
      process.stdout.off('resize', onResize);
    };
  }, []);

  return size;
}
