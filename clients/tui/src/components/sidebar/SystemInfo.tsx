/**
 * 系统信息:上下文用量、Token、费用
 */
import React from 'react';
import { Box, Text } from 'ink';
import { color } from '../../utils/colors.js';
import { formatTokens } from '../../utils/format.js';

export interface SystemInfoProps {
  contextWindow: number;
  contextUsed: number;
  spent: number;
  cwd?: string;
  cliVersion?: string;
}

export const SystemInfo: React.FC<SystemInfoProps> = ({
  contextWindow,
  contextUsed,
  spent,
  cwd,
  cliVersion,
}) => {
  const pct = contextWindow > 0 ? Math.round((contextUsed / contextWindow) * 100) : 0;
  return (
    <Box flexDirection="column">
      <Text color={color.highlight} bold>Context</Text>
      <Text color={color.muted}>{formatTokens(contextUsed)} / {formatTokens(contextWindow)} tokens</Text>
      <Text color={color.muted}>{pct}% used</Text>
      <Text color={color.muted}>${spent.toFixed(2)} spent</Text>
      {cwd && <Text color={color.muted} dimColor>{cwd}</Text>}
      {cliVersion && <Text color={color.success}>* {cliVersion}</Text>}
    </Box>
  );
};
