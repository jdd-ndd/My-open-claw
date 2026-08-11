/**
 * 帮助面板
 */
import React from 'react';
import { Box, Text, useInput } from 'ink';
import { color } from '../utils/colors.js';

export interface HelpPanelProps {
  onClose: () => void;
  title?: string;
}

const SHORTCUTS: ReadonlyArray<[string, string]> = [
  ['Enter', 'launch 页面 → 进入 chat;  chat 页面 → 发送消息'],
  ['Shift+Enter', '在输入框插入换行'],
  ['Tab', '切换焦点: 输入 → 消息列表 → 侧边栏 → 输入'],
  ['↑ / ↓', '消息列表: 按行滚动;  侧边栏: 切换 session;  输入框: 浏览历史'],
  ['PageUp / PageDown', '消息列表按屏翻页'],
  ['G', '消息列表跳到最新'],
  ['Esc', 'chat 页面: 取消流 / 退回 launch;  help 页面: 关闭'],
  ['?', '打开 / 关闭帮助面板'],
  ['Ctrl+C', '退出应用'],
];

export const HelpPanel: React.FC<HelpPanelProps> = ({ onClose, title = 'Keyboard Help' }) => {
  useInput(
    (_v, key) => {
      if (key.escape) onClose();
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={4} paddingY={2}>
      <Text color={color.highlight} bold>
        {title}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {SHORTCUTS.map(([k, desc]) => (
          <Box key={k}>
            <Box width={20}>
              <Text color={color.primary}>{k}</Text>
            </Box>
            <Text color={color.muted}>{desc}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={2}>
        <Text color={color.primary}>Press Esc to return</Text>
      </Box>
    </Box>
  );
};
