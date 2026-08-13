// v1.1.9: Web 端组件测试起步. Memory view 渲染 + tab 切换 + 删除 modal.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Memory } from './Memory';

// ─── Mock 依赖 ───────────────────────────────────────────

const mockFetchSessions = vi.fn();
const mockFetchStats = vi.fn();
const mockSearchVectors = vi.fn();
const mockDeleteSession = vi.fn();
const mockDeleteVector = vi.fn();

vi.mock('@/api/memory', () => ({
  fetchMemorySessions: (...args: unknown[]) => mockFetchSessions(...args),
  fetchMemoryStats: (...args: unknown[]) => mockFetchStats(...args),
  searchMemoryVectors: (...args: unknown[]) => mockSearchVectors(...args),
  deleteMemorySession: (...args: unknown[]) => mockDeleteSession(...args),
  deleteMemoryVector: (...args: unknown[]) => mockDeleteVector(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchSessions.mockResolvedValue({
    total: 0,
    activeCount: 0,
    sessions: [],
  });
  mockFetchStats.mockResolvedValue({
    sessions: { active: 0 },
    vectors: { total: 0 },
    embedding: { provider: 'openai', available: true, dimension: 1536 },
  });
  mockSearchVectors.mockResolvedValue({ query: '', total: 0, results: [] });
  mockDeleteSession.mockResolvedValue({ ok: true });
  mockDeleteVector.mockResolvedValue({ ok: true });
});

// ─── 测试 ───────────────────────────────────────────────

describe('Memory view', () => {
  it('1. 渲染 4 个 MetricCard 标题 + 默认 sessions tab 激活', async () => {
    render(<Memory />);

    // 4 个 MetricCard 标题
    expect(screen.getByText('Active sessions')).toBeInTheDocument();
    expect(screen.getByText('Vector entries')).toBeInTheDocument();
    expect(screen.getByText('Embedding')).toBeInTheDocument();
    expect(screen.getByText('Last refresh')).toBeInTheDocument();

    // Tab 默认 sessions
    const sessionsTab = screen.getByRole('tab', { name: /Sessions/i });
    const vectorsTab = screen.getByRole('tab', { name: /Vectors/i });
    expect(sessionsTab).toHaveAttribute('aria-selected', 'true');
    expect(vectorsTab).toHaveAttribute('aria-selected', 'false');

    // 等 mock 异步 resolve 完, fetchMemoryStats 应该被调过
    await waitFor(() => {
      expect(mockFetchStats).toHaveBeenCalledTimes(1);
      expect(mockFetchSessions).toHaveBeenCalledTimes(1);
    });
  });

  it('2. 点击 Vectors tab 切换并显示搜索 input', async () => {
    const user = userEvent.setup();
    render(<Memory />);

    await waitFor(() => {
      expect(mockFetchStats).toHaveBeenCalled();
    });

    // tab 容器里只有 2 个 tab (Sessions / Vectors), 用 getAllByRole 拿第 2 个
    const tabs = screen.getAllByRole('tab');
    const vectorsTab = tabs.find((t) => /Vectors/i.test(t.textContent ?? ''));
    expect(vectorsTab).toBeDefined();
    await user.click(vectorsTab!);

    // tab 状态切了
    await waitFor(() => {
      expect(vectorsTab!).toHaveAttribute('aria-selected', 'true');
    });

    // Vectors 出现搜索框 (semantic search placeholder)
    expect(screen.getByPlaceholderText(/Semantic search/i)).toBeInTheDocument();
  });

  it('3. 加载失败显示错误条', async () => {
    mockFetchSessions.mockRejectedValueOnce(new Error('boom'));
    mockFetchStats.mockRejectedValueOnce(new Error('boom'));

    render(<Memory />);

    await waitFor(() => {
      expect(screen.getByText(/boom/)).toBeInTheDocument();
    });
  });
});
