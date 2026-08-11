/**
 * 状态栏连接徽章
 */
import React from 'react';
import { Text } from 'ink';
import { color } from '../../utils/colors.js';
import type { ConnectionState } from '../../types/ui.js';

export interface ConnectionBadgeProps {
  state: ConnectionState;
}

export const ConnectionBadge: React.FC<ConnectionBadgeProps> = ({ state }) => {
  const map: Record<ConnectionState, { label: string; c: string }> = {
    connected: { label: '● connected', c: color.success },
    connecting: { label: '◐ connecting', c: color.warning },
    reconnecting: { label: '◑ reconnecting', c: color.warning },
    disconnected: { label: '○ disconnected', c: color.danger },
  };
  const { label: text, c } = map[state];
  return <Text color={c}>{text}</Text>;
};
