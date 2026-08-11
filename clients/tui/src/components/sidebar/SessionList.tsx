/**
 * 会话列表
 */
import React from 'react';
import { Box, Text } from 'ink';
import { color } from '../../utils/colors.js';
import type { Session } from '../../types/session.js';

export interface SessionListProps {
  sessions: Session[];
  selectedIndex?: number;
  activeSessionId?: string;
}

export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  selectedIndex = 0,
  activeSessionId,
}) => {
  return (
    <Box flexDirection="column">
      <Text color={color.highlight} bold>
        Sessions
      </Text>
      {sessions.length === 0 && (
        <Text color={color.muted} dimColor>
          (empty)
        </Text>
      )}
      {sessions.map((s, i) => {
        const isSelected = i === selectedIndex;
        const isActive = s.id === activeSessionId;
        return (
          <Box key={s.id} flexDirection="row">
            <Text color={isSelected ? color.primary : color.muted}>
              {isSelected ? '▶ ' : '  '}
              {isActive ? '● ' : '○ '}
              {s.title}
              {typeof s.messageCount === 'number' && (
                <Text color={color.muted} dimColor>
                  {' '}
                  ({s.messageCount})
                </Text>
              )}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
