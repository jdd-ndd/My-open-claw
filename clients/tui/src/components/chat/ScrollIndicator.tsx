/**
 * 滚动指示器
 * 显示当前滚动位置与可见/总数
 */
import React from 'react';
import { Box, Text } from 'ink';
import { color } from '../../utils/colors.js';

export interface ScrollIndicatorProps {
  total: number;
  visible: number;
  offset: number;
}

export const ScrollIndicator: React.FC<ScrollIndicatorProps> = ({ total, visible, offset }) => {
  if (total === 0) return null;
  const start = Math.min(offset + 1, total);
  const end = Math.min(offset + visible, total);
  return (
    <Box>
      <Text color={color.muted} dimColor>
        [{start}-{end} / {total}]
      </Text>
    </Box>
  );
};
