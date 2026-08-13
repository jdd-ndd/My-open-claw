// v1.2.0: 扩 Web 组件测试. MemoryInspector 渲染 + load + 错误态.
// 覆盖: 无 sessionId / 有 sessionId 成功 load / load 失败显示错误.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryInspector } from './MemoryInspector';

// ─── Mock 依赖 ───────────────────────────────────────────

const mockGetMemorySession = vi.fn();
vi.mock('@/api/memory', () => ({
  getMemorySession: (...args: unknown[]) => mockGetMemorySession(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 测试 ───────────────────────────────────────────────

describe('MemoryInspector 渲染', () => {
  it('1. 无 sessionId 时显示 "未选择会话" + Refresh 按钮 disabled', () => {
    render(<MemoryInspector sessionId={null} />);

    expect(screen.getByText(/未选择会话/)).toBeInTheDocument();
    // Refresh button disabled
    const refreshBtn = screen.getByRole('button', { name: /刷新/ });
    expect(refreshBtn).toBeDisabled();
  });

  it('2. 有 sessionId 时调 getMemorySession + 显示 userId/channelId/agentId', async () => {
    mockGetMemorySession.mockResolvedValue({
      sessionId: 'chat-7a2f',
      userId: 'user-001',
      channelId: 'webchat',
      agentId: 'jarvis',
      messages: [
        { id: 'm1', role: 'user', content: 'hello', timestamp: Date.now() },
      ],
      metadata: { messageCount: 5, createdAt: Date.now() - 1000, lastActiveAt: Date.now() },
    });

    render(<MemoryInspector sessionId="chat-7a2f" />);

    // 等 load 完
    await waitFor(() => {
      expect(mockGetMemorySession).toHaveBeenCalledWith('chat-7a2f');
    });

    // 字段显示
    expect(screen.getByText('user-001')).toBeInTheDocument();
    expect(screen.getByText('webchat')).toBeInTheDocument();
    expect(screen.getByText('jarvis')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument(); // messageCount
  });

  it('3. getMemorySession 失败时显示错误条 + "读取失败" 标题', async () => {
    mockGetMemorySession.mockRejectedValue(new Error('boom'));

    render(<MemoryInspector sessionId="chat-bad" />);

    await waitFor(() => {
      expect(screen.getByText('读取失败')).toBeInTheDocument();
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
  });
});
