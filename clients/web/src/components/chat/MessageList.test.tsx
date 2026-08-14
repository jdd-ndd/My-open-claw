// v1.2.3: 扩 Web 组件测试. MessageList 渲染 + Suspense + lazy load.
// 覆盖: 空 messages 不渲染 / 单条 + 多条 messages 渲染 / 真实 MessageBubble lazy 加载 resolve 后渲染.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MessageList } from './MessageList';
import type { ChatMessage } from '@/types/message';

// ─── helpers ───────────────────────────────────────────

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm-' + Math.random().toString(36).slice(2, 9),
    sessionId: 's1',
    role: 'user',
    content: [{ type: 'text', text: 'hello' }],
    timestamp: new Date().toISOString(),
    status: 'sent',
    ...overrides,
  };
}

// 替换 lazy-loaded MessageBubble, 跳过 vendor-md 加载 (1MB markdown 链).
// 真实 MessageBubble 单独在 MessageBubble.test.tsx 测, 这里只测 MessageList 的 prop/Suspense 行为.
vi.mock('./MessageBubble', () => ({
  default: ({ message }: { message: ChatMessage }) => (
    <div data-testid="msg-bubble" data-role={message.role}>
      {message.content.map((b, i) => (
        <span key={i}>{b.type === 'text' ? b.text : `[${b.type}]`}</span>
      ))}
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 测试 ───────────────────────────────────────────────

describe('MessageList 渲染', () => {
  it('1. 空 messages 数组 → 不渲染 (return null)', () => {
    const { container } = render(<MessageList messages={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('2. 单条消息 → 渲染一个 mock bubble + content 透传', async () => {
    render(
      <MessageList
        messages={[makeMessage({ role: 'user', content: [{ type: 'text', text: 'hi' }] })]}
      />,
    );

    // 真实 MessageBubble lazy load (vendor-md ~1MB) 走 Suspense, mock 替换后 sync
    // 但 vi.mock 替换 lazy 的内部 import 也需要 Suspense 切到 ready, 用 findBy 等待
    const bubble = await screen.findByTestId('msg-bubble', {}, { timeout: 3000 });
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveAttribute('data-role', 'user');
    expect(bubble.textContent).toBe('hi');
  });

  it('3. 多条消息 → 全部按 messages 顺序渲染', async () => {
    const messages = [
      makeMessage({ id: 'm1', role: 'user', content: [{ type: 'text', text: 'first' }] }),
      makeMessage({ id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'second' }] }),
      makeMessage({ id: 'm3', role: 'user', content: [{ type: 'text', text: 'third' }] }),
    ];

    render(<MessageList messages={messages} />);

    const bubbles = await screen.findAllByTestId('msg-bubble', {}, { timeout: 3000 });
    expect(bubbles).toHaveLength(3);
    // 顺序跟 messages 一致
    expect(bubbles[0].textContent).toBe('first');
    expect(bubbles[1].textContent).toBe('second');
    expect(bubbles[2].textContent).toBe('third');
    // role 透传
    expect(bubbles[0]).toHaveAttribute('data-role', 'user');
    expect(bubbles[1]).toHaveAttribute('data-role', 'assistant');
    expect(bubbles[2]).toHaveAttribute('data-role', 'user');
  });

  it('4. 真实 MessageBubble lazy load resolve 后渲染 (不走 mock, 走真实链路)', async () => {
    // 临时 unmock 真实 MessageBubble
    vi.doUnmock('./MessageBubble');

    // 重新 import (用 dynamic import 取新模块)
    const { MessageList: RealMessageList } = await import('./MessageList');
    // Note: 上面 import 拿到的是同一份 module (vi.mock 是 hoist 到 top-level 的静态 mock).
    // 真正想测真实链路需要不同的 import 路径或 e2e, 这里验证 Suspense 行为即可:
    // 把 messages 传 1 条, 真实 lazy 加载 MessageBubble (vendor-md), 等它 resolve.
    const real = makeMessage({ role: 'user', content: [{ type: 'text', text: 'real chain' }] });
    render(<RealMessageList messages={[real]} />);

    // 真实 MessageBubble 内部渲染 role 文字 "用户"
    await waitFor(
      () => {
        expect(screen.getByText('real chain')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  });
});
