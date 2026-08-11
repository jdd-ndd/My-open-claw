/**
 * Agent 状态卡片
 */
import React from 'react';
import { Box, Text } from 'ink';
import { color } from '../../utils/colors.js';
import type { AgentInfo } from '../../types/session.js';

export interface AgentStatusProps {
  agents: AgentInfo[];
  selectedIndex?: number;
}

export const AgentStatus: React.FC<AgentStatusProps> = ({ agents, selectedIndex = 0 }) => {
  return (
    <Box flexDirection="column">
      <Text color={color.highlight} bold>
        Agents
      </Text>
      {agents.length === 0 && (
        <Text color={color.muted} dimColor>
          (empty)
        </Text>
      )}
      {agents.map((agent, i) => {
        const isSelected = i === selectedIndex;
        const statusColor =
          agent.status === 'busy' ? color.warning : agent.status === 'error' ? color.danger : color.success;
        return (
          <Box key={agent.id} flexDirection="row">
            <Text color={isSelected ? color.primary : color.muted}>
              {isSelected ? '▶ ' : '  '}
              {agent.name} [{agent.model}]{' '}
              <Text color={statusColor}>
                {agent.status === 'busy' ? '●' : agent.status === 'error' ? '✕' : '○'} {agent.status}
              </Text>
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
