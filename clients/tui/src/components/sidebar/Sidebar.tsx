/**
 * 侧边栏组合组件
 * 整合 SystemInfo / AgentStatus / SessionList
 */
import React from 'react';
import { Box, Text } from 'ink';
import { color } from '../../utils/colors.js';
import type { FocusArea } from '../../types/ui.js';
import type { AgentInfo, Session, ConnectionInfo } from '../../types/session.js';
import { SystemInfo } from './SystemInfo.js';
import { AgentStatus } from './AgentStatus.js';
import { SessionList } from './SessionList.js';

export interface SidebarProps {
  focus: FocusArea;
  connection: ConnectionInfo;
  agents: AgentInfo[];
  sessions: Session[];
  selectedSessionIndex: number;
  activeSessionId?: string;
  contextWindow: number;
  contextUsed: number;
  spent: number;
  cwd: string;
  cliVersion: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  focus,
  connection,
  agents,
  sessions,
  selectedSessionIndex,
  activeSessionId,
  contextWindow,
  contextUsed,
  spent,
  cwd,
  cliVersion,
}) => {
  const isFocused = focus === 'sidebar';
  const connColor = connection.state === 'connected' ? color.success
    : connection.state === 'connecting' || connection.state === 'reconnecting' ? color.warning
    : color.danger;

  return (
    <Box
      width={32}
      flexDirection="column"
      paddingX={1}
      borderStyle={isFocused ? 'single' : 'single'}
      borderColor={isFocused ? color.primary : color.muted}
    >
      <Text color={color.highlight} bold>Connection</Text>
      <Text color={connColor} bold>[{connection.state}]</Text>
      {connection.endpoint && (
        <Text color={color.muted} dimColor>{connection.endpoint}</Text>
      )}

      <Box marginTop={1}>
        <SystemInfo
          contextWindow={contextWindow}
          contextUsed={contextUsed}
          spent={spent}
          cwd={cwd}
          cliVersion={cliVersion}
        />
      </Box>

      <Box marginTop={1}>
        <AgentStatus agents={agents} selectedIndex={0} />
      </Box>

      <Box marginTop={1}>
        <SessionList
          sessions={sessions}
          selectedIndex={selectedSessionIndex}
          activeSessionId={activeSessionId}
        />
      </Box>

      <Box marginTop={1}>
        <Text color={color.muted} dimColor>
          Tab: {isFocused ? 'main' : 'sidebar'}
        </Text>
      </Box>
    </Box>
  );
};
