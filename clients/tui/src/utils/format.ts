/**
 * 通用格式化工具
 */

import type { MessageRole } from '../types/ui.js';

export function formatNow(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatTime(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${value}`;
}

export function formatRole(role: MessageRole): string {
  switch (role) {
    case 'user':
      return 'You';
    case 'assistant':
      return 'Assistant';
    case 'system':
      return 'System';
  }
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * 简易 wrap:按可视列宽把字符串拆成多行
 *
 * 规则:
 * - 已有 \n 按 \n 切
 * - 其它行若超过 width,按空白或硬切到 width
 * - 不可见字符(宽字符)按 1 列计算(本终端 ASCII 即可)
 */
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine.length === 0) {
      out.push('');
      continue;
    }
    if (rawLine.length <= width) {
      out.push(rawLine);
      continue;
    }
    // 优先按空白切
    let line = rawLine;
    while (line.length > width) {
      let cut = line.lastIndexOf(' ', width);
      if (cut <= 0) cut = width; // 无空白可切,硬切
      out.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^\s+/, '');
    }
    out.push(line);
  }
  return out;
}
