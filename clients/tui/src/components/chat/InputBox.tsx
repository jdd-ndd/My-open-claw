/**
 * 输入框组件
 *
 * 特性:
 * - 打字不触发 App 重渲染(本组件内部 state 闭环)
 * - Enter 发送;Shift+Enter 换行
 * - ↑/↓ 浏览发送历史
 * - 光标左右移动
 *
 * 关键修复(对比上一版):
 * - 删去底部"Enter 发送 | Shift+Enter 换行 | ↑↓ 历史 | Tab 切换焦点" 这条冗余提示
 *   (这些快捷键在 HelpPanel 和 StatusBar 已有展示)
 * - placeholder 简化
 */

import React, { useCallback, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { color } from '../../utils/colors.js';

export interface InputBoxProps {
  focus: boolean;
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const InputBox: React.FC<InputBoxProps> = ({
  focus,
  onSend,
  disabled = false,
  placeholder = '输入消息,Enter 发送,Shift+Enter 换行',
}) => {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [cursor, setCursor] = useState(0);

  const send = useCallback(() => {
    const t = input.trim();
    if (t && !disabled) {
      onSend(t);
      setHistory((p) => [...p, t]);
      setInput('');
      setCursor(0);
      setHistoryIndex(-1);
    }
  }, [input, disabled, onSend]);

  useInput(
    (v, k) => {
      if (disabled || !focus) return;
      // 守卫 1:readline 把 ESC 序列的 ESC 剥掉后,key.escape=true
      if (k.escape) return;
      // 守卫 2:value 首字符是 ESC (0x1b) — readline 偶尔会这样
      if (v && v.charCodeAt(0) === 0x1b) return;
      // 守卫 3:SGR mouse / 未识别的 CSI 序列 — value 以 "[<" 开头
      if (v && v.startsWith('[<')) return;
      // 守卫 4:含其他控制字符 / ANSI 序列碎片
      // 注意:必须放行 \t (0x09) \n (0x0a) \r (0x0d) 三个合法控制字符
      // (回车 Enter 触发 readline emit value='\r' + key.return=true,
      // 如果把 0x0d 也拦了,Enter 就废了)
      if (v && /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)) return;
      if (k.return && !k.shift) {
        send();
        return;
      }
      if (k.return && k.shift) {
        setInput((p) => p.slice(0, cursor) + '\n' + p.slice(cursor));
        setCursor((p) => p + 1);
        return;
      }
      if (k.backspace || k.delete) {
        if (cursor > 0) {
          setInput((p) => p.slice(0, cursor - 1) + p.slice(cursor));
          setCursor((p) => p - 1);
        }
        return;
      }
      if (k.upArrow) {
        if (historyIndex < history.length - 1) {
          const next = historyIndex + 1;
          setHistoryIndex(next);
          const h = history[history.length - 1 - next];
          setInput(h);
          setCursor(h.length);
        }
        return;
      }
      if (k.downArrow) {
        if (historyIndex > 0) {
          const next = historyIndex - 1;
          setHistoryIndex(next);
          const h = history[history.length - 1 - next];
          setInput(h);
          setCursor(h.length);
        } else if (historyIndex === 0) {
          setHistoryIndex(-1);
          setInput('');
          setCursor(0);
        }
        return;
      }
      if (k.leftArrow) {
        setCursor((p) => Math.max(0, p - 1));
        return;
      }
      if (k.rightArrow) {
        setCursor((p) => Math.min(input.length, p + 1));
        return;
      }
      if (v && !k.ctrl && !k.meta && !k.tab) {
        setInput((p) => p.slice(0, cursor) + v + p.slice(cursor));
        setCursor((p) => p + v.length);
      }
    },
    { isActive: focus && !disabled },
  );

  // 把光标前 / 光标后 拆分,中间插一个高亮空格当光标
  const before = input.slice(0, cursor);
  const at = input[cursor] ?? ' ';
  const after = input.slice(cursor + 1);

  return (
    <Box flexDirection="row">
      <Text color={focus && !disabled ? color.primary : color.muted} bold>
        {'> '}
      </Text>
      <Box flexGrow={1}>
        {input.length === 0 ? (
          <Text color={color.muted}>{placeholder}</Text>
        ) : (
          <Text color={color.highlight}>
            {before}
            <Text backgroundColor={focus && !disabled ? color.primary : color.muted} color="black">
              {at}
            </Text>
            {after}
          </Text>
        )}
        {/* 当输入为空时,额外画一个静态光标方块(仅在 focus 时) */}
        {input.length === 0 && focus && !disabled && (
          <Text backgroundColor={color.primary} color="black">
            {' '}
          </Text>
        )}
      </Box>
    </Box>
  );
};
