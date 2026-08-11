/**
 * 流式输出气泡
 *
 * 渲染当前正在生成中的 assistant 回复,作为"最后一条消息"显示。
 * 同时实时显示思考过程(reasoning_content)。
 *
 * 阶段:
 * - 只有 reasoning 在流:显示 💭 思考中 + 内容
 * - reasoning 结束、chat 开始:折叠 reasoning,显示 ⠋ 生成中
 * - 都在流:同时显示(两段)
 *
 * 与 MessageList 中的历史消息用同一种行高计算函数,这样:
 * - 滚到底部时,流式气泡始终紧贴视口底
 * - 长流式文本能让视口自动撑高
 *
 * 性能:
 * - 仅当 streamingContent / reasoningContent / 各自长度变化才重渲染
 * - 父级 MessageList 不会因为 streamingContent 变化而重渲染其他兄弟节点
 */

import React, { memo, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { color } from '../../utils/colors.js';
import { wrapText } from '../../utils/format.js';

export interface StreamingBubbleProps {
  prompt: string;
  content: string;
  reasoning: string;
  time: string;
  width: number;
}

export function streamingBubbleLines(
  content: string,
  reasoning: string,
  width: number,
): number {
  const widthSafe = Math.max(4, width - 2);
  // header(1)
  let lines = 1;
  if (reasoning.trim().length > 0) {
    // 思考中(1) + 折叠时内容(N)
    const r = wrapText(reasoning, Math.max(2, widthSafe - 2)).length;
    lines += 1 + r;
  }
  if (content.length > 0 || reasoning.length === 0) {
    // 正在生成(1) + 内容(N) + meta(1)
    const c = wrapText(content || ' ', widthSafe).length;
    lines += 1 + c + 1;
  } else {
    // 只有 reasoning:加 1 行 "切换到正文..."
    lines += 1;
  }
  return lines;
}

const SPINNERS = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const StreamingBubble: React.FC<StreamingBubbleProps> = memo(
  ({ content, reasoning, time, width }) => {
    const widthSafe = Math.max(4, width - 2);
    const contentLines = wrapText(content || ' ', widthSafe);
    const reasoningLines = reasoning ? wrapText(reasoning, Math.max(2, widthSafe - 2)) : [];

    const idxRef = useRef(0);
    const [spinner, setSpinner] = React.useState(SPINNERS[0]!);

    useEffect(() => {
      const t = setInterval(() => {
        idxRef.current = (idxRef.current + 1) % SPINNERS.length;
        setSpinner(SPINNERS[idxRef.current]!);
      }, 80);
      return () => clearInterval(t);
    }, []);

    const hasReasoning = reasoning.trim().length > 0;
    const hasContent = content.length > 0;
    // 阶段判断:有 reasoning 但还没出 chat → 思考中;两者都有 → 思考+生成
    const stage: 'reasoning' | 'generating' | 'both' = (() => {
      if (hasReasoning && hasContent) return 'both';
      if (hasReasoning) return 'reasoning';
      return 'generating';
    })();

    return (
      <Box flexDirection="row" marginBottom={1}>
        <Box width={1} flexShrink={0}>
          <Text color={color.muted} bold>
            ▌
          </Text>
        </Box>

        <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
          <Box justifyContent="space-between">
            <Text color={color.highlight} bold>
              {spinner} Assistant
            </Text>
            <Text color={color.muted} dimColor>
              {time}
            </Text>
          </Box>

          {/* 思考过程(永远展开,实时增量) */}
          {hasReasoning && (
            <Box flexDirection="column" marginTop={0}>
              <Text color={color.warning} dimColor>
                💭 思考中 · {reasoning.length} chars
              </Text>
              <Box flexDirection="column" paddingLeft={2}>
                {reasoningLines.map((line, i) => (
                  <Text key={i} color={color.muted} dimColor wrap="wrap">
                    {line || ' '}
                  </Text>
                ))}
              </Box>
            </Box>
          )}

          {/* chat 内容(还没开始时,显示等待提示) */}
          {stage === 'reasoning' ? (
            <Box marginTop={0}>
              <Text color={color.muted} dimColor>
                等待正文…
              </Text>
            </Box>
          ) : (
            <>
              <Box flexDirection="column" marginTop={0}>
                {contentLines.map((line, i) => (
                  <Text key={i} color={color.highlight} wrap="wrap">
                    {line || ' '}
                  </Text>
                ))}
              </Box>
              <Box marginTop={0}>
                <Text color={color.warning} dimColor>
                  {hasReasoning ? '·' : '·'} {content.length} chars · Esc 取消
                </Text>
              </Box>
            </>
          )}
        </Box>
      </Box>
    );
  },
  (prev, next) =>
    prev.content === next.content &&
    prev.reasoning === next.reasoning &&
    prev.time === next.time &&
    prev.width === next.width,
);
StreamingBubble.displayName = 'StreamingBubble';
