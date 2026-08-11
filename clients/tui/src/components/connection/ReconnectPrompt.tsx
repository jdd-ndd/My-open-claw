/**
 * 重连提示组件
 */
import React from 'react';
import { Box, Text, useInput } from 'ink';
import { color } from '../../utils/colors.js';

export interface ReconnectPromptProps {
  onReconnect: () => void;
  onCancel?: () => void;
  message?: string;
}

export const ReconnectPrompt: React.FC<ReconnectPromptProps> = ({
  onReconnect,
  onCancel,
  message = 'Connection lost. Press R to reconnect, Esc to cancel.',
}) => {
  useInput((value, key) => {
    if (key.escape) onCancel?.();
    if (value === 'r' || value === 'R') onReconnect();
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color.danger} paddingX={2} paddingY={1}>
      <Text color={color.danger} bold>{message}</Text>
    </Box>
  );
};
