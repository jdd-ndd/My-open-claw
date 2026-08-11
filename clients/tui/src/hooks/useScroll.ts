/**
 * 按行虚拟滚动 Hook
 *
 * 核心思想:
 * - 每条 item 渲染需要若干"行"(content + 时间戳 + 间距)
 * - 把 items 的累积行数作为整体高度,scrollOffset 也是行数
 * - 给定 offset,反向找出哪些 items 落在 [total - offset - viewport, total - offset] 区间
 *
 * 关键修复(对比上一版):
 * - 移除了 render body 里的 setState(违反 React 规则,易引发抖动)
 * - 加 userScrolledAway 状态:用户主动滚走(offset > 0)后置 true,
 *   父组件用这个守门 sticky bottom 行为,避免 streaming 触发 useEffect
 *   把用户已经滚走的位置强制拉回底部
 * - 暴露 userScrolledAway / jumpToLatest API
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseScrollOptions<T> {
  items: T[];
  /** 视口行数 */
  viewport: number;
  /** 计算每条 item 占用行数的函数(默认 1) */
  getLines?: (item: T, index: number) => number;
  /** 距底 follow 阈值(行),在此范围内都算"贴底" */
  followThreshold?: number;
}

export interface UseScrollResult<T> {
  /** 当前可见的 item 切片(已经按原始顺序) */
  visible: T[];
  /** 可见 item 在原数组中的索引区间 [start, end) */
  range: { start: number; end: number };
  /** 当前滚动偏移(行) */
  offset: number;
  /** 视口总行数 */
  viewport: number;
  /** 所有 item 累计行高 */
  totalLines: number;
  /** 最大可滚 offset(0 = 贴底) */
  maxOffset: number;
  /** 是否已贴底(用于 follow 守门) */
  atBottom: boolean;
  /** 用户是否已经主动滚走;父组件应据此决定要不要自动 follow */
  userScrolledAway: boolean;
  /** 上一行 */
  lineUp: () => void;
  /** 下一行 */
  lineDown: () => void;
  /** 上一屏 */
  pageUp: () => void;
  /** 下一屏 */
  pageDown: () => void;
  /** 跳到顶部 */
  scrollTop: () => void;
  /** 跳到底部(同时清掉 userScrolledAway) */
  jumpToLatest: () => void;
  /** 设置任意偏移 */
  setOffset: (n: number) => void;
  /** 强制贴底(用于 sticky bottom) */
  follow: () => void;
}

export function useScroll<T>(opts: UseScrollOptions<T>): UseScrollResult<T> {
  const { items, viewport, getLines, followThreshold = 1 } = opts;
  const get = getLines ?? ((() => 1));

  // 每个 item 的行高
  const linesPerItem = useMemo(
    () => items.map((it, i) => Math.max(1, get(it, i))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, get],
  );

  const totalLines = useMemo(() => linesPerItem.reduce((s, n) => s + n, 0), [linesPerItem]);
  const maxOffset = Math.max(0, totalLines - viewport);

  const [offset, setOffsetState] = useState(maxOffset);
  const atBottomRef = useRef(true);
  const [userScrolledAway, setUserScrolledAway] = useState(false);

  const clamp = useCallback((n: number) => Math.min(maxOffset, Math.max(0, n)), [maxOffset]);

  // 当 totalLines 减少(maxOffset 变小), 收缩 offset 保持视口位置稳定
  useEffect(() => {
    setOffsetState((cur) => {
      const next = Math.min(maxOffset, Math.max(0, cur));
      const atBot = next >= maxOffset - followThreshold;
      atBottomRef.current = atBot;
      return next;
    });
  }, [maxOffset, followThreshold]);

  // ── 滚动动作 ──
  const setOffset = useCallback(
    (n: number) => {
      const next = clamp(n);
      setOffsetState(next);
      const atBot = next >= maxOffset - followThreshold;
      atBottomRef.current = atBot;
      // 用户主动 setOffset 到非底部位置,标记为"已滚走"
      setUserScrolledAway(!atBot);
    },
    [clamp, maxOffset, followThreshold],
  );

  const lineUp = useCallback(() => setOffset(offset + 1), [offset, setOffset]);
  const lineDown = useCallback(() => setOffset(offset - 1), [offset, setOffset]);
  const pageUp = useCallback(
    () => setOffset(offset + Math.max(1, viewport)),
    [offset, setOffset, viewport],
  );
  const pageDown = useCallback(
    () => setOffset(offset - Math.max(1, viewport)),
    [offset, setOffset, viewport],
  );
  const scrollTop = useCallback(() => setOffset(0), [setOffset]);
  const jumpToLatest = useCallback(() => {
    atBottomRef.current = true;
    setUserScrolledAway(false);
    setOffsetState(maxOffset);
  }, [maxOffset]);
  const follow = jumpToLatest; // alias

  // ── 可见区间计算 ──
  const range = useMemo(() => {
    if (items.length === 0) return { start: 0, end: 0 };
    const endLine = totalLines - offset;
    const startLine = endLine - viewport;
    let acc = 0;
    let start = items.length;
    let end = items.length;
    for (let i = 0; i < items.length; i++) {
      const h = linesPerItem[i]!;
      if (acc + h > startLine && start === items.length) start = i;
      if (acc >= endLine) {
        end = i;
        break;
      }
      acc += h;
    }
    if (end === items.length) end = items.length;
    if (start === items.length) start = Math.max(0, items.length - 1);
    return { start, end };
  }, [items, linesPerItem, offset, viewport, totalLines]);

  const visible = useMemo(
    () => items.slice(range.start, range.end),
    [items, range.start, range.end],
  );

  return {
    visible,
    range,
    offset,
    viewport,
    totalLines,
    maxOffset,
    atBottom: atBottomRef.current,
    userScrolledAway,
    lineUp,
    lineDown,
    pageUp,
    pageDown,
    scrollTop,
    jumpToLatest,
    setOffset,
    follow,
  };
}
