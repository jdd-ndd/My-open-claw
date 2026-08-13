// v1.1.9: Web 端组件测试起步. SystemOverview 渲染测试.
// 覆盖: 4 个 section h2 标题出现 + 顶部 badge + 健康时显示 "Healthy".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemOverview } from './SystemOverview';

// ─── Mock 依赖 ───────────────────────────────────────────

const mockFetchHealth = vi.fn();
const mockFetchSystemStatus = vi.fn();
const mockFetchAgents = vi.fn();
const mockFetchTools = vi.fn();
const mockFetchSkills = vi.fn();
const mockFetchSchedulerTasks = vi.fn();

vi.mock('@/api/system', () => ({
  fetchHealth: (...args: unknown[]) => mockFetchHealth(...args),
  fetchSystemStatus: (...args: unknown[]) => mockFetchSystemStatus(...args),
  fetchAgents: (...args: unknown[]) => mockFetchAgents(...args),
  fetchSchedulerTasks: (...args: unknown[]) => mockFetchSchedulerTasks(...args),
}));

vi.mock('@/api/skills', () => ({
  fetchTools: (...args: unknown[]) => mockFetchTools(...args),
  fetchSkills: (...args: unknown[]) => mockFetchSkills(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchHealth.mockResolvedValue({ status: 'healthy', uptimeSeconds: 3600, version: '1.1.9' });
  mockFetchSystemStatus.mockResolvedValue({ channels: ['qqbot', 'feishu'], startedAt: '2026-08-14T00:00:00Z' });
  mockFetchAgents.mockResolvedValue({ agents: [
    { id: 'jarvis', name: 'Jarvis', status: 'ready' },
    { id: 'monitor', name: 'Monitor', status: 'ready' },
  ] });
  mockFetchTools.mockResolvedValue({ total: 28, builtin: 28, custom: 0 });
  mockFetchSkills.mockResolvedValue({ total: 5, loaded: 5 });
  mockFetchSchedulerTasks.mockResolvedValue({ total: 3, enabled: 2, tasks: [] });
});

// ─── 测试 ───────────────────────────────────────────────

describe('SystemOverview view', () => {
  it('1. 渲染 4 个分区 (h2) + 顶部 System overview badge', async () => {
    render(<SystemOverview />);

    // 4 个 h2 section
    expect(screen.getByRole('heading', { level: 2, name: 'Core runtime' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Integration focus' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Agent activity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Health components' })).toBeInTheDocument();

    // 顶部 badge
    expect(screen.getByText('System overview')).toBeInTheDocument();
    // 标题
    expect(screen.getByRole('heading', { level: 1, name: /Runtime health/i })).toBeInTheDocument();

    // 等 6 个 fetch 全部 resolve
    await waitFor(() => {
      expect(mockFetchHealth).toHaveBeenCalledTimes(1);
      expect(mockFetchSystemStatus).toHaveBeenCalledTimes(1);
      expect(mockFetchAgents).toHaveBeenCalledTimes(1);
      expect(mockFetchTools).toHaveBeenCalledTimes(1);
      expect(mockFetchSkills).toHaveBeenCalledTimes(1);
      expect(mockFetchSchedulerTasks).toHaveBeenCalledTimes(1);
    });
  });

  it('2. 健康时显示 "Healthy" + 点击 Refresh 重新 fetch', async () => {
    const user = userEvent.setup();
    render(<SystemOverview />);

    // waitFor 内部等 state='ready' 后 summary?.healthOk 为 true → "Healthy"
    await waitFor(() => {
      expect(screen.getByText('Healthy')).toBeInTheDocument();
    });

    // 点击 Refresh 重新 fetch (getAllByRole 因为 lucide icon 可能也有 button role)
    const refreshBtns = screen.getAllByRole('button', { name: /Refresh/i });
    expect(refreshBtns.length).toBeGreaterThanOrEqual(1);
    await user.click(refreshBtns[0]);

    await waitFor(() => {
      expect(mockFetchHealth).toHaveBeenCalledTimes(2);
      expect(mockFetchSystemStatus).toHaveBeenCalledTimes(2);
    });
  });
});
