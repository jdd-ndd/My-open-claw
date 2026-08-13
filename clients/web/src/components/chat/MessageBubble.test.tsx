// v1.2.0: 扩 Web 组件测试. MessageBubble 渲染 + role 分支 + final_answer 提取.
// 覆盖: user 角色显示 "用户" / assistant 角色显示 "贾维斯" / <final_answer> 标签只显示内部内容.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageBubble from './MessageBubble';
import type { ChatMessage } from '@/types/message';

// ─── helper ─────────────────────────────────────────────

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    sessionId: 's1',
    role: 'user',
    content: [{ type: 'text', text: 'hello' }],
    timestamp: new Date().toISOString(),
    status: 'sent',
    ...overrides,
  };
}

// ─── 测试 ───────────────────────────────────────────────

describe('MessageBubble 渲染', () => {
  it('1. user 角色显示 "用户" 名称 + text block 渲染', () => {
    render(
      <MessageBubble
        message={makeMessage({
          role: 'user',
          content: [{ type: 'text', text: 'hello world' }],
        })}
      />,
    );
    expect(screen.getByText('用户')).toBeInTheDocument();
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('2. assistant 角色显示 "贾维斯" 名称', () => {
    render(
      <MessageBubble
        message={makeMessage({
          role: 'assistant',
          content: [{ type: 'text', text: 'hi there' }],
        })}
      />,
    );
    expect(screen.getByText('贾维斯')).toBeInTheDocument();
    expect(screen.getByText('hi there')).toBeInTheDocument();
  });

  it('3. 含 <final_answer> 标签时只显示内部内容', () => {
    render(
      <MessageBubble
        message={makeMessage({
          role: 'assistant',
          content: [
            { type: 'text', text: '<final_answer>这是最终答案</final_answer>' },
          ],
        })}
      />,
    );
    // 内部内容应该渲染
    expect(screen.getByText('这是最终答案')).toBeInTheDocument();
    // 标签本身不应该作为字面文字出现
    expect(screen.queryByText(/<final_answer>/)).not.toBeInTheDocument();
  });

  it('4. tool 角色显示 "工具" 名称', () => {
    render(
      <MessageBubble
        message={makeMessage({
          role: 'tool',
          content: [{ type: 'text', text: 'tool result' }],
        })}
      />,
    );
    expect(screen.getByText('工具')).toBeInTheDocument();
  });
});
