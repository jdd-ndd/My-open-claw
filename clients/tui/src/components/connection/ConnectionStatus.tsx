/**
 * 连接状态指示
 */
import React from 'react';
import { Box, Text } from 'ink';
import { color } from '../../utils/colors.js';
import type { ConnectionState } from '../../types/ui.js';

export interface ConnectionStatusProps {
  state: ConnectionState;
  endpoint?: string;
  onReconnect?: () => void;
}

const label: Record<ConnectionState, string> = {
  connected: 'connected',
  connecting: 'connecting...',
  reconnecting: 'reconnecting...',
  disconnected: 'disconnected',
};

const stateColor: Record<ConnectionState, string> = {
  connected: color.success,
  connecting: color.warning,
  reconnecting: color.warning,
  disconnected: color.danger,
};

export const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ state, endpoint }) => {
  return (
    <Box>
      <Text color={color.muted}>connection: </Text>
      <Text color={stateColor[state]} bold>[{label[state]}]</Text>
      {endpoint && <Text color={color.muted} dimColor> {endpoint}</Text>}
    </Box>
  );
};
