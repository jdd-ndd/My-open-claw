/**
 * 消息列表组件 —— OpenCode 风格
 *
 * ┌─ 红色方框 ─────────────────────────────────────────┐
 * │ History · N msgs                       ↑↓ 滚动   │  ← 内部 header
 * │ ───────────────────────────────────────────────   │
 * │  ▌ You                          14:32            │
 * │    你好                                          │
 * │  ▌ Assistant                    14:33            │
 * │    嗯嗯                                          │
 * │    ▶ 思考过程 (按 R 展开)                          │
 * │  ▌ Assistant                    14:34            │
 * │    ⠋ 思考中…                                     │
 * │  ─────────────────────────────────────────────   │
 * │                ↓ G 跳到最新                        │  ← 滚动状态
 * └────────────────────────────────────────────────┘
 *
 * 关键:
 * - 整个消息区是**带边框的 Box**,框内是滚动视口,框外不流动
 * - 滚动只发生在该 Box 内部,使用 useScroll 按行虚拟滚动
 * - streaming bubble **单独 render**,不参与 useScroll 的 items 数组,
 *   这样 maxOffset 稳定,不会随 streamingContent 长度抖动
 * - sticky 底部用 useScroll 的 userScrolledAway 守门:
 *   用户主动滚走后,不再自动 follow,直到用户按 G/jumpToLatest
 */

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ActiveStream, ChatMessage } from '../../types/ui.js';
import { color } from '../../utils/colors.js';
import { useScroll } from '../../hooks/useScroll.js';
import { MessageItem, messageItemLines } from './MessageItem.js';
import { StreamingBubble, streamingBubbleLines } from './StreamingBubble.js';

export interface MessageListHandle {
  lineUp: () => void;
  lineDown: () => void;
  pageUp: () => void;
  pageDown: () => void;
  scrollTop: () => void;
  jumpToLatest: () => void;
  /**
   * 给定内容区行号(0-based,从可见消息第 0 行起),返回该行所属消息及是否落在
   * 「▶/▼ 思考过程」折叠指示行上 — 用于鼠标点击展开/收起。
   *
   * 返回 null 表示该行不在任何消息上(空行、loading 提示、滚动边界外等)。
   */
  getClickTarget: (contentLine: number) => { messageId: string; isFoldLine: boolean } | null;
  /** 切换指定消息的 reasoning 展开 */
  toggleReasoning: (messageId: string) => void;
  /** 切换最近一条带 reasoning 的消息的展开(给 R 键用) */
  toggleLastReasoning: () => void;
}

export interface MessageListProps {
  messages: ChatMessage[];
  /** 当前正在生成中的流(若没有则不渲染底部气泡) */
  activeStream: ActiveStream | null;
  /** 流式累积内容(chat 正文) */
  streamingContent: string;
  /** 流式累积内容(reasoning_content) */
  streamingReasoning: string;
  /** 渲染区可用列宽(含 border + padding) */
  width: number;
  /** 视口行数(消息列表容器高度,含 border + 内部 header/footer) */
  viewport: number;

  // ── 历史加载 ──
  loadingHistory?: boolean;
  hasMoreHistory?: boolean;
  onLoadMore?: () => void;

  // ── 焦点(仅在 focus 时响应键盘) ──
  focus?: boolean;
  /** 取消流(Esc) */
  onCancelStream?: () => void;
}

const INTERNAL_HEADER_LINES = 1;
const INTERNAL_FOOTER_LINES = 1;
const BORDER_LINES = 2;

export const MessageList = memo(forwardRef<MessageListHandle, MessageListProps>(function MessageList(
  {
    messages,
    activeStream,
    streamingContent,
    streamingReasoning,
    width,
    viewport,
    loadingHistory = false,
    hasMoreHistory = false,
    onLoadMore,
    focus = false,
    onCancelStream,
  },
  ref,
) {
    // 框内可用列宽:去掉左右 border (2) + 两侧 paddingX=1 (2) = 4
    const innerWidth = Math.max(10, width - 4);
    // 框内可用行数:去掉上下 border (2) + 内部 header (1) + 内部 footer (1)
    const innerRows = Math.max(4, viewport - BORDER_LINES);
    const contentViewport = Math.max(2, innerRows - INTERNAL_HEADER_LINES - INTERNAL_FOOTER_LINES);

    // 思考过程展开状态
    const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set());

    // 最近一条带 reasoning 的消息 id(用于 R 键)
    const lastReasoningId = useMemo(() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m && m.reasoning && m.reasoning.trim().length > 0) {
          return m.id;
        }
      }
      return null;
    }, [messages]);

    // 行高计算:稳定(不依赖 streamingContent)
    const getLines = useCallback(
      (m: ChatMessage) => messageItemLines(m, innerWidth, expandedReasoning.has(m.id)),
      [innerWidth, expandedReasoning],
    );

    // 给 streaming bubble 预留固定行数(避免 maxOffset 抖动)
    // 估算:上限 30 行(实际由 StreamingBubble 自然 wrap,超出会被裁剪)
    const STREAM_RESERVED_LINES = 30;
    const scrollViewport = Math.max(2, contentViewport - (activeStream ? STREAM_RESERVED_LINES : 0));

    // useScroll 只处理 messages,streaming bubble 单独 render
    const scroll = useScroll({
      items: messages,
      viewport: scrollViewport,
      getLines,
    });

    // ── 可见消息行位置表(给鼠标点击用) ──
    // 每个可见消息的 firstLine / lastLine / 折叠行(若有)
    // 0-based,行号从可见消息区第 0 行起(messageItemLines 累加得到)
    const lineMap = useMemo(() => {
      const map = new Map<string, { firstLine: number; lastLine: number; foldLine: number }>();
      let cum = 0;
      for (const m of scroll.visible) {
        const lines = getLines(m);
        const hasReasoning = !!(m.reasoning && m.reasoning.trim().length > 0);
        // 折叠行 = 消息最后一行(只有当有 reasoning 时才存在)
        // 折叠展开时也是最后 1 行("▼ 思考过程 · 0.6s"),所以 foldLine 始终是 lastLine
        const foldLine = hasReasoning ? cum + lines - 1 : -1;
        map.set(m.id, { firstLine: cum, lastLine: cum + lines - 1, foldLine });
        cum += lines;
      }
      return map;
      // 依赖:visible 列表、每条消息的 line count(folded 状态)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scroll.visible, expandedReasoning, innerWidth]);

    // 暴露给父组件的 imperative handle(供 mouse wheel / 点击等场景调用)
    useImperativeHandle(
      ref,
      () => ({
        lineUp: scroll.lineUp,
        lineDown: scroll.lineDown,
        pageUp: scroll.pageUp,
        pageDown: scroll.pageDown,
        scrollTop: scroll.scrollTop,
        jumpToLatest: scroll.jumpToLatest,
        getClickTarget: (contentLine: number) => {
          if (contentLine < 0) return null;
          for (const m of scroll.visible) {
            const entry = lineMap.get(m.id);
            if (!entry) continue;
            if (contentLine >= entry.firstLine && contentLine <= entry.lastLine) {
              return { messageId: m.id, isFoldLine: contentLine === entry.foldLine };
            }
          }
          return null;
        },
        toggleReasoning: (messageId: string) => {
          setExpandedReasoning((prev) => {
            const next = new Set(prev);
            if (next.has(messageId)) next.delete(messageId);
            else next.add(messageId);
            return next;
          });
        },
        toggleLastReasoning: () => {
          if (lastReasoningId) {
            setExpandedReasoning((prev) => {
              const next = new Set(prev);
              if (next.has(lastReasoningId)) next.delete(lastReasoningId);
              else next.add(lastReasoningId);
              return next;
            });
          }
        },
      }),
      [scroll, lineMap, lastReasoningId],
    );

    // ── sticky 底部:守门 ──
    // 只有没滚走时才 follow;用户主动滚走后,streaming 不会把他拉回
    const wasUserScrolledAway = useRef(false);
    useEffect(() => {
      wasUserScrolledAway.current = scroll.userScrolledAway;
    }, [scroll.userScrolledAway]);

    useEffect(() => {
      if (!wasUserScrolledAway.current) {
        scroll.follow();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.length, streamingContent, streamingReasoning, activeStream?.id]);

    // ── 历史加载:接近顶时 ──
    useEffect(() => {
      if (!focus || !hasMoreHistory || loadingHistory) return;
      // 接近顶部(已滚出 N 行)
      if (scroll.offset <= Math.max(2, Math.floor(scroll.viewport / 3))) {
        onLoadMore?.();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scroll.offset, scroll.viewport, hasMoreHistory, loadingHistory, focus]);

    // ── 键盘 ──
    // 注释:R 键移到 App 顶层(避免 InputBox 等其他 useInput 干扰),这里只处理滚动
    useInput(
      (_v, key) => {
        if (key.upArrow) {
          scroll.lineUp();
          return;
        }
        if (key.downArrow) {
          scroll.lineDown();
          return;
        }
        if (key.pageUp) {
          scroll.pageUp();
          return;
        }
        if (key.pageDown) {
          scroll.pageDown();
          return;
        }
        if (key.escape && activeStream) {
          onCancelStream?.();
          return;
        }
        // G:跳到最新(同时清掉 userScrolledAway)
        if (key.shift && _v === 'G') {
          scroll.jumpToLatest();
          return;
        }
        // g:跳到顶
        if (!key.shift && _v === 'g') {
          scroll.scrollTop();
          return;
        }
      },
      { isActive: focus },
    );

    const borderColor = focus ? color.primary : color.muted;
    const showLoadMoreHint = hasMoreHistory && !loadingHistory && scroll.offset === 0;
    const totalCount = messages.length + (activeStream ? 1 : 0);
    // streaming bubble 的实际行数(用于提示)
    const streamLineCount = activeStream
      ? streamingBubbleLines(streamingContent, streamingReasoning, innerWidth)
      : 0;

    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor={borderColor}
        paddingX={1}
        width={width}
      >
        {/* 内部 header */}
        <Box justifyContent="space-between">
          <Text color={focus ? color.primary : color.muted} bold>
            History · {totalCount} msgs
          </Text>
          <Text color={color.muted} dimColor>
            {focus ? '↑↓ scroll · click ▶ to expand reasoning · G jump to latest' : 'Tab to focus'}
          </Text>
        </Box>

        {/* 加载提示 */}
        {loadingHistory && (
          <Box>
            <Text color={color.muted} dimColor>
              加载历史消息中…
            </Text>
          </Box>
        )}
        {showLoadMoreHint && (
          <Box>
            <Text color={color.muted} dimColor>
              ↑ 按 ↑ 或 PageUp 加载更多历史
            </Text>
          </Box>
        )}

        {/* 消息列表(虚拟视口) + streaming bubble(单独 render) */}
        <Box flexDirection="column" flexGrow={1}>
          {scroll.visible.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              width={innerWidth}
              reasoningExpanded={expandedReasoning.has(m.id)}
            />
          ))}
          {scroll.visible.length === 0 && (
            <Box>
              <Text color={color.muted} dimColor>
                {messages.length === 0 ? '暂无消息,在下方输入框开始对话…' : '(已滚到边界)'}
              </Text>
            </Box>
          )}
          {activeStream && (
            <StreamingBubble
              prompt={activeStream.prompt}
              content={streamingContent}
              reasoning={streamingReasoning}
              time={activeStream.time}
              width={innerWidth}
            />
          )}
        </Box>

        {/* 内部 footer(滚动状态 + 跳最新提示) */}
        <Box justifyContent="space-between">
          <Text color={color.muted} dimColor>
            {scroll.userScrolledAway ? `offset ${scroll.offset}` : '贴底'}
            {activeStream ? `  · streaming ${streamLineCount} lines` : ''}
          </Text>
          {scroll.userScrolledAway ? (
            <Text color={color.primary}>↓ G jump to latest</Text>
          ) : (
            <Text color={color.muted} dimColor> </Text>
          )}
        </Box>
      </Box>
    );
  },
));

MessageList.displayName = 'MessageList';
