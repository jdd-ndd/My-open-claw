// v1.2.0: 扩 Web 组件测试. SettingsPanel 渲染 + tab 切换.
// v1.2.5: 改用真 ModelPicker (SettingsPanel + ModelPicker 集成), MemoryInspector 仍 mock (有 getMemorySession fetch 依赖).
// 覆盖: open=false / open=true 4 tab / 切 Memory tab / close 按钮 / 真 ModelPicker 渲染 / 切 provider 后切走再切回 provider 保持 / 选 model 后切走再切回 model 保持 / 切非 Model tab 不影响 store.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from './SettingsPanel';
import { useSettingsStore } from '@/stores/useSettingsStore';

// ─── Mock 依赖 ───────────────────────────────────────────

// ModelPicker 不再 mock, 走真链路 (跟 v1.2.5 SettingsPanel 集成测试配套).
// MemoryInspector 仍 mock (有 getMemorySession fetch 依赖, 在别处单独测).
vi.mock('./MemoryInspector', () => ({
  MemoryInspector: () => <div data-testid="memory-inspector">MemoryInspector</div>,
}));

beforeEach(() => {
  // 重置 zustand store 到默认值, 避免 v1.2.5 跨 test 状态污染
  useSettingsStore.setState({
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-chat',
    modelSpeed: 'default',
  });
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

    // 默认激活 Models tab → 真 ModelPicker 渲染 (h3="DeepSeek" + "2 models" 标签)
    expect(screen.getByRole('heading', { name: 'DeepSeek' })).toBeInTheDocument();
    expect(screen.getByText(/2 models/i)).toBeInTheDocument();
  });

  it('3. 点击 Memory tab 切换到 MemoryInspector (ModelPicker 消失)', async () => {
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
    // ModelPicker 切走后消失 (h3 DeepSeek 没了)
    expect(screen.queryByRole('heading', { name: 'DeepSeek' })).not.toBeInTheDocument();
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

  // v1.2.5: SettingsPanel + 真 ModelPicker 集成测试
  // 验证切走 tab 再切回时, ModelPicker 通过 useSettingsStore 跟 store 同步

  it('5. 在 ModelPicker 切 provider 到 OpenAI → 切到 Memory tab → 切回 Model tab → provider 保持 OpenAI', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 默认 deepseek
    expect(useSettingsStore.getState().defaultProvider).toBe('deepseek');

    // 找 sidebar 里 OpenAI 按钮 (跟 v1.2.1 ModelPicker test 同款 pattern)
    const sidebar = screen.getByText('Providers', { selector: 'p' }).parentElement!;
    const openaiBtn = within(sidebar.closest('aside')!).getByRole('button', { name: /OpenAI/i });
    await user.click(openaiBtn);

    // store 切到 openai
    expect(useSettingsStore.getState().defaultProvider).toBe('openai');

    // 切到 Memory tab
    const memoryTab = screen.getAllByRole('button', { name: 'Memory' }).find(
      (btn) => btn.textContent === 'Memory',
    );
    await user.click(memoryTab!);
    await waitFor(() => {
      expect(screen.getByTestId('memory-inspector')).toBeInTheDocument();
    });

    // 切回 Models tab
    const modelsTab = screen.getByRole('button', { name: 'Models' });
    await user.click(modelsTab);

    // 真 ModelPicker 重新渲染, h3 应是 "OpenAI" (provider 保持)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'OpenAI' })).toBeInTheDocument();
    });
    // store 状态保持
    expect(useSettingsStore.getState().defaultProvider).toBe('openai');
  });

  it('6. 选具体 model (V4 Pro) → 切到 Memory → 切回 Model → model 保持', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 默认 deepseek + deepseek-chat
    expect(useSettingsStore.getState().defaultModel).toBe('deepseek-chat');

    // 选 V4 Pro (deepseek-v4-pro) - 在右侧 model 列表
    const v4Pro = screen.getByRole('button', { name: /V4 Pro/i });
    await user.click(v4Pro);
    expect(useSettingsStore.getState().defaultModel).toBe('deepseek-v4-pro');

    // 切到 Memory 再切回
    const memoryTab = screen.getAllByRole('button', { name: 'Memory' }).find(
      (btn) => btn.textContent === 'Memory',
    );
    await user.click(memoryTab!);
    await waitFor(() => {
      expect(screen.getByTestId('memory-inspector')).toBeInTheDocument();
    });
    const modelsTab = screen.getByRole('button', { name: 'Models' });
    await user.click(modelsTab);

    // store 状态保持
    expect(useSettingsStore.getState().defaultModel).toBe('deepseek-v4-pro');
  });

  it('7. 切到 Channel / Interface tab 不影响 provider (store 保持)', async () => {
    const user = userEvent.setup();
    render(<SettingsPanel open={true} onClose={() => {}} />);

    // 默认 deepseek
    expect(useSettingsStore.getState().defaultProvider).toBe('deepseek');

    // 切到 Channel
    const channelTab = screen.getByRole('button', { name: 'Channel' });
    await user.click(channelTab);
    // Channel tab 内容 (default channel select) 出现
    expect(screen.getByText('Default channel')).toBeInTheDocument();
    // provider 没动
    expect(useSettingsStore.getState().defaultProvider).toBe('deepseek');

    // 切到 Interface
    const interfaceTab = screen.getByRole('button', { name: 'Interface' });
    await user.click(interfaceTab);
    // Interface tab 内容 (Theme mode 等) 出现
    expect(screen.getByText('Theme mode')).toBeInTheDocument();
    expect(useSettingsStore.getState().defaultProvider).toBe('deepseek');

    // 切回 Models, 真 ModelPicker 渲染 DeepSeek (state 保持)
    const modelsTab = screen.getByRole('button', { name: 'Models' });
    await user.click(modelsTab);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'DeepSeek' })).toBeInTheDocument();
    });
  });
});
