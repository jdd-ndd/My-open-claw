/**
 * 鼠标事件 Hook
 *
 * 启用 SGR mouse encoding 后,terminal 会把鼠标事件转成 ANSI 序列
 * 发送到 stdin。监听 'data' 事件并解析。
 *
 * SGR mouse format:
 *   press:   \x1b[<Cb;Cx;CyM   (大写 M)
 *   release: \x1b[<Cb;Cx;Cym   (小写 m)
 *
 * Cb (button code):
 *   0  = left
 *   1  = middle
 *   2  = right
 *   64 = wheel up
 *   65 = wheel down
 *
 * Cx, Cy = 1-based 列/行
 */

import { useEffect, useRef, useState } from 'react';

export type MouseButton = 'left' | 'middle' | 'right' | 'wheel-up' | 'wheel-down';
export type MouseEventType = 'press' | 'release' | 'wheel';

export interface MouseEvent {
  type: MouseEventType;
  button: MouseButton;
  col: number; // 1-based
  row: number; // 1-based
}

const SGR_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

function parseMouseBuffer(str: string): MouseEvent | null {
  // 取出第一个匹配的 mouse 事件(同一帧可能有多个)
  const m = SGR_RE.exec(str);
  if (!m) return null;
  // reset lastIndex 以便下次从 0 开始
  SGR_RE.lastIndex = 0;

  const cb = parseInt(m[1]!, 10);
  const cx = parseInt(m[2]!, 10);
  const cy = parseInt(m[3]!, 10);
  const isRelease = m[4] === 'm';

  // 白名单:仅识别标准 SGR mouse button code
  //   0  = left press
  //   1  = middle press
  //   2  = right press
  //   3  = release (无 button / 也用于 wheel release)
  //   32-34 = drag with button(1002h motion)
  //   64 = wheel up
  //   65 = wheel down
  // 其他(例如 35 = motion with release)直接丢弃,避免污染 input
  if (cb === 64) return { type: 'wheel', button: 'wheel-up', col: cx, row: cy };
  if (cb === 65) return { type: 'wheel', button: 'wheel-down', col: cx, row: cy };
  if (cb === 0 || cb === 32)
    return { type: isRelease ? 'release' : 'press', button: 'left', col: cx, row: cy };
  if (cb === 1 || cb === 33)
    return { type: isRelease ? 'release' : 'press', button: 'middle', col: cx, row: cy };
  if (cb === 2 || cb === 34)
    return { type: isRelease ? 'release' : 'press', button: 'right', col: cx, row: cy };
  if (cb === 3) return null; // release-only event,无业务意义,吞掉
  // 不识别的 Cb 一律丢弃
  return null;
}

export function useMouse(handler?: (event: MouseEvent) => void): {
  /** 最近一次 mouse 事件(每个事件会重新 setState,所以引用每次都新) */
  lastEvent: MouseEvent | null;
} {
  const [lastEvent, setLastEvent] = useState<MouseEvent | null>(null);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!process.stdin.isTTY) return;
    const onData = (chunk: Buffer | string) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (!str.includes('\x1b[<')) return; // 快速过滤
      const ev = parseMouseBuffer(str);
      if (!ev) return;
      setLastEvent(ev);
      handlerRef.current?.(ev);
    };
    process.stdin.on('data', onData);
    return () => {
      process.stdin.off('data', onData);
    };
  }, []);

  return { lastEvent };
}
