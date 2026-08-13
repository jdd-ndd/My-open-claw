// v1.2.0: 扩 Web 组件测试. SettingsPanel 渲染 + tab 切换.
// 覆盖: open=false 不渲染 / open=true 4 tab 显示 / 切换 tab 到 Memory 触发子组件.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from './SettingsPanel';

// ─── Mock 依赖 ───────────────────────────────────────────

// ModelPicker / MemoryInspector 复杂依赖多, mock 掉避免 test 拉一堆 store / API
vi.mock('./ModelPicker', () => ({
  ModelPicker: () => <div data-testid="model-picker">ModelPicker</div>,
}));
vi.mock('./MemoryInspector', () => ({
  MemoryInspector: () => <div data-testid="memory-inspector">MemoryInspector</div>,
}));

beforeEach(() => {
  // 重置 zustand store (默认 default settings)
  // 简单做法: 直接调 localStorage.clear + page reload, 或 import useSettingsStore.getState().resetSettings
  // 这里用 dynamic import 避免循环:
  // (实际 v1.2.0 store 有 resetSettings, 但保险起见 reload)
});

// ─── 测试 ───────────────────────────────────────────────

describe('SettingsPanel 渲染', () => {
  it('1. open=false 时不渲染任何内容', () => {
    const { container } = render(<SettingsPanel open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('2. open=true 时渲染 4 个 tab (Models / Channel / Interface / Memory)', () => {
    render(<SettingsPanel open={true} onClose={() => {}} />);

    expect(screen.getByRole('button', { name: 'Models' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Channel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Interface' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Memory' })).toBeInTheDocument();

    // 默认激活 Models tab → ModelPicker 出现
    expect(screen.getByTestId('model-picker')).toBeInTheDocument();
  });

  it('3. 点击 Memory tab 切换到 MemoryInspector', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 4 个 tab 都叫 "Models/Channel/Interface/Memory", 用 getAllByRole 拿 tab
    const memoryTab = screen.getAllByRole('button', { name: 'Memory' }).find(
      (btn) => btn.textContent === 'Memory',
    );
    expect(memoryTab).toBeDefined();
    await user.click(memoryTab!);

    // ModelPicker 消失, MemoryInspector 出现
    await waitFor(() => {
      expect(screen.getByTestId('memory-inspector')).toBeInTheDocument();
    });
    // ModelPicker tab 内容 (model-picker div) 切走后应消失
    expect(screen.queryByTestId('model-picker')).not.toBeInTheDocument();
  });

  it('4. 点击 close 按钮触发 onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsPanel open={true} onClose={onClose} />);

    // 用 aria-label (v1.2.0 给 close button 加的) 拿 close button
    const closeBtn = screen.getByRole('button', { name: /close settings/i });
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
