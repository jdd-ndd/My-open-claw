/**
 * 单条消息渲染组件
 *
 * OpenCode 风格:
 * ┌─ ▌ ─┐
 * │ 你好 │  ← 用户消息(左蓝竖线)
 * └─────┘
 * ┌─ ▌ ─┐
 * │ 嗯嗯 │  ← 助手(左灰竖线)
 * │      │
 * │ 💭 思考过程 (按 R 展开)│  ← 默认折叠
 * │      │ 展开后:
 * │ │ 我需要考虑...      │
 * └─────┘
 *
 * 关键点:
 * - 每条消息是一个独立 Box,左边 1 字符宽的"色块"作装饰
 *   - user: 蓝色
 *   - assistant: 灰色(或 focus 时 primary)
 *   - system/error: 红色
 * - 思考过程默认折叠(节省屏宽),按 R 切换
 * - memo() 防止 streaming 时其他消息被波及
 */

import React, { memo } from 'react';
import { Box, Text } from 'ink';
import type { ChatMessage } from '../../types/ui.js';
import { color } from '../../utils/colors.js';
import { formatRole, wrapText } from '../../utils/format.js';

export interface MessageItemProps {
  message: ChatMessage;
  /** 渲染区可用列宽(用于 wrap;边线占 1 字符) */
  width: number;
  /**
   * reasoning 是否展开(由 MessageList 统一管控,避免组件各自为政)
   * 之前这里有自管 useState,导致 R 键 / 鼠标点击改了上层 state 却不影响这里显示
   * 鼠标点击在 App 顶层 useMouse → MessageList.getClickTarget 路由后改父 state,
   * 父 state 变化触发 reasoningExpanded prop 更新 → 这里刷新
   */
  reasoningExpanded: boolean;
}

function barColorFor(role: ChatMessage['role'], hasError: boolean): string {
  if (hasError || role === 'system') return color.danger;
  if (role === 'user') return color.primary;
  return color.muted;
}

function roleTextColor(role: ChatMessage['role'], hasError: boolean): string {
  if (hasError || role === 'system') return color.warning;
  if (role === 'user') return color.primary;
  return color.highlight;
}

function isErrorMessage(m: ChatMessage): boolean {
  return m.role === 'system' || m.content.startsWith('[error') || m.content.startsWith('[send failed');
}

export const MessageItem: React.FC<MessageItemProps> = memo(
  ({ message, width, reasoningExpanded }) => {
    const isError = isErrorMessage(message);
    const barColor = barColorFor(message.role, isError);
    const textColor = roleTextColor(message.role, isError);
    const widthSafe = Math.max(4, width - 2); // 减 1 边线 + 1 间距
    const contentLines = wrapText(message.content, widthSafe);
    const hasReasoning = Boolean(message.reasoning && message.reasoning.trim().length > 0);

    // 关键:showReasoning 状态完全由 MessageList 通过 reasoningExpanded prop 注入
    // — 之前这里自管 useState,导致 R 键 / 鼠标改了上层 state 这里不刷新
    // — onToggleReasoning 由 MessageList 提供,这里只负责触发回调
    // — 鼠标点击的判定由 App 顶层 useMouse 路由 → messageListRef.toggleReasoning
    //   完成(因为 Ink 没有子组件级 mouse,我们用 box hit area 是不行的,所以走 row 定位)
    // — 这里把 ▶ 字符用 inverseColor 反白显示,作为可点击的视觉提示
    const showReasoning = reasoningExpanded;

    return (
      <Box flexDirection="row" marginBottom={1}>
        {/* 左侧色块 ▌ */}
        <Box width={1} flexShrink={0}>
          <Text color={barColor} bold>
            ▌
          </Text>
        </Box>

        {/* 内容区 */}
        <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
          {/* header 行:role + time */}
          <Box justifyContent="space-between">
            <Text color={textColor} bold>
              {formatRole(message.role)}
            </Text>
            <Text color={color.muted} dimColor>
              {message.time}
              {message.reasoningDurationMs !== undefined && hasReasoning
                ? `  💭 ${(message.reasoningDurationMs / 1000).toFixed(1)}s`
                : ''}
            </Text>
          </Box>

          {/* 正文 */}
          <Box flexDirection="column">
            {contentLines.map((line, i) => (
              <Text key={i} color={textColor} wrap="wrap">
                {line || ' '}
              </Text>
            ))}
          </Box>

          {/* 思考过程(默认折叠) */}
          {hasReasoning && (
            <Box flexDirection="column" marginTop={1}>
              {/* 折叠指示行 — 鼠标点击这一行展开/收起。
                  ▶/▼ 字符用 bold + primary 色突出,作可点击视觉提示。
                  R 键也作为键盘兜底(由 App 顶层 useInput 拦截)。 */}
              <Text color={color.muted} dimColor={!showReasoning}>
                <Text color={color.primary} bold>
                  {showReasoning ? '▼' : '▶'}
                </Text>
                {' '}
                {showReasoning ? '思考过程' : '思考过程 (点击 ▶ 展开 · R 键切换)'}
                {message.reasoningDurationMs !== undefined && ` · ${(message.reasoningDurationMs / 1000).toFixed(1)}s`}
              </Text>
              {showReasoning && (
                <Box marginTop={0} flexDirection="column" paddingLeft={2}>
                  {wrapText(message.reasoning!, Math.max(2, widthSafe - 2)).map((line, i) => (
                    <Text key={i} color={color.muted} dimColor wrap="wrap">
                      {line || ' '}
                    </Text>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Box>
    );
  },
  // 自定义 memo:只在自己 message 引用 / 字段变时才重渲染
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.reasoning === next.message.reasoning &&
    prev.message.time === next.message.time &&
    prev.width === next.width &&
    prev.reasoningExpanded === next.reasoningExpanded,
);
MessageItem.displayName = 'MessageItem';

/**
 * 暴露给 useScroll 的行高计算函数
 * 包括:边线(0,我们用 inline ▌ 不占额外行)+ header(1) + content(N) + reasoning 折叠时(1)/展开时(N+1)
 */
export function messageItemLines(m: ChatMessage, width: number, reasoningExpanded: boolean): number {
  const widthSafe = Math.max(4, width - 2);
  const body = wrapText(m.content, widthSafe).length;
  let lines = 1 + body; // header + body
  if (m.reasoning && m.reasoning.trim().length > 0) {
    if (reasoningExpanded) {
      const r = wrapText(m.reasoning, Math.max(2, widthSafe - 2)).length;
      lines += 1 + r; // ▶ 思考过程 + 内容
    } else {
      lines += 1; // ▶ 思考过程 (按 R 展开)
    }
  }
  return lines;
}
