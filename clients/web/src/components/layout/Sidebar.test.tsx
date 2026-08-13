// v1.1.9: Web 端组件测试起步. Sidebar 渲染测试.
// 覆盖: 版本号显示 + 关键导航按钮存在 + 新建会话按钮.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as RR from 'react-router-dom';
import { Sidebar } from './Sidebar';

// ─── Mock 依赖 ───────────────────────────────────────────

// 隔离 useSession, 返回空 sessions + 简化方法
vi.mock('@/hooks/useSession', () => ({
  useSession: () => ({
    sessions: [],
    currentSessionId: null,
    createSession: vi.fn().mockResolvedValue({ id: 'new-1' }),
    switchSession: vi.fn(),
    renameSession: vi.fn(),
    deleteSession: vi.fn(),
    pinSession: vi.fn(),
    autoRenameFromFirstMessage: vi.fn(),
  }),
}));

// 隔离 useNavigate (保留其他 export, 只 mock useNavigate)
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof RR>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// 注入版本号: vi.stubEnv 临时 patch import.meta.env, 比直接赋值干净,
// 也避免 vitest 1.3 类型对 import.meta.env.VITE_APP_VERSION 报 readonly.
beforeEach(() => {
  mockNavigate.mockReset();
  vi.stubEnv('VITE_APP_VERSION', '1.1.9');
});

// ─── 测试 ───────────────────────────────────────────────

describe('Sidebar 渲染', () => {
  it('1. 渲染底部版本号 (从 VITE_APP_VERSION 读)', () => {
    render(<Sidebar />);
    expect(screen.getByText(/v1\.1\.9/)).toBeInTheDocument();
  });

  it('2. 渲染 Memory 跟 System overview 入口按钮', () => {
    render(<Sidebar />);
    // 用 getAllByRole 因为 Sidebar 内的 monitor sessions (QQ/飞书) 也会触发 button 渲染,
    // 这里只关心"至少存在一个 System overview/Memory 入口".
    expect(screen.getAllByRole('button', { name: 'System overview' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: 'Memory' }).length).toBeGreaterThanOrEqual(1);
  });

  it('3. 点击 Memory 按钮触发 navigate(\'/memory\')', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    // Sidebar 内部 /memory 导航按钮通过 onClick 调 navigate('/memory'),
    // 我们只关心 "Memory 入口存在且能触发 navigate", 不验证唯一性.
    const memoryButtons = screen.getAllByRole('button', { name: 'Memory' });
    expect(memoryButtons.length).toBeGreaterThanOrEqual(1);
    await user.click(memoryButtons[0]);

    expect(mockNavigate).toHaveBeenCalledWith('/memory');
  });
});
