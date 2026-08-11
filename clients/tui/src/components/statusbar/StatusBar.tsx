/**
 * 状态栏:左 cwd,中 消息计数 + focus,右 连接 + 模型
 */
import React from 'react';
import { Box, Text } from 'ink';
import { color } from '../../utils/colors.js';
import type { ConnectionState, FocusArea } from '../../types/ui.js';
import { ConnectionBadge } from './ConnectionBadge.js';
import { ModelIndicator } from './ModelIndicator.js';

export interface StatusBarProps {
  cwd: string;
  messageCount: number;
  connection: ConnectionState;
  provider: string;
  model: string;
  focus?: FocusArea;
}

const FOCUS_HINT: Record<FocusArea, string> = {
  input: '[Tab → 消息]',
  messages: '[Tab → 侧边栏]',
  sidebar: '[Tab → 输入]',
};

export const StatusBar: React.FC<StatusBarProps> = ({
  cwd,
  messageCount,
  connection,
  provider,
  model,
  focus,
}) => {
  return (
    <Box justifyContent="space-between" paddingX={1} height={1} borderStyle="single" borderColor={color.muted}>
      <Text color={color.muted}>{cwd}</Text>
      <Text color={color.muted}>
        {messageCount} msgs{focus ? `  ·  ${FOCUS_HINT[focus]}` : ''}
      </Text>
      <Box>
        <ConnectionBadge state={connection} />
        <Text color={color.muted}> · </Text>
        <ModelIndicator provider={provider} model={model} />
      </Box>
    </Box>
  );
};
