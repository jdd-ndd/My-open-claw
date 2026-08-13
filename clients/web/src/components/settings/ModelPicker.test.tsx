// v1.2.1: 扩 Web 组件测试. ModelPicker 真实子组件 + defaultProvider 切换.
// 覆盖: 3 providers 渲染 / 切 provider 改 activeProvider / 选具体 model / 切 speed / Cancel 触发 onClose.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelPicker } from './ModelPicker';
import { useSettingsStore, type ModelSpeedMode } from '@/stores/useSettingsStore';

// ─── helpers ───────────────────────────────────────────

/**
 * 重置 settings store 到默认值, 避免 persist 中间件在跨 test 泄漏状态.
 * zustand `resetSettings` action 把 state 写回 DEFAULT_SETTINGS, 但 persist storage 不清空.
 * 在这里直接 `setState(DEFAULT_SETTINGS-like)` 保险一些.
 */
function resetSettings() {
  useSettingsStore.setState({
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-chat',
    modelSpeed: 'default',
  });
}

beforeEach(() => {
  resetSettings();
});

// ─── 测试 ───────────────────────────────────────────────

describe('ModelPicker 真实子组件渲染', () => {
  it('1. 渲染 3 个 provider (DeepSeek / OpenClaw API / OpenAI) + 默认 deepseek 激活', () => {
    render(<ModelPicker onClose={vi.fn()} />);

    // sidebar 3 个 provider 按钮, 文字包含 label
    const sidebar = screen.getByText('Providers', { selector: 'p' }).parentElement!;
    const deepseekBtn = within(sidebar.closest('aside')!).getByRole('button', { name: /DeepSeek/i });
    const openclawBtn = within(sidebar.closest('aside')!).getByRole('button', { name: /OpenClaw API/i });
    const openaiBtn = within(sidebar.closest('aside')!).getByRole('button', { name: /OpenAI/i });

    expect(deepseekBtn).toBeInTheDocument();
    expect(openclawBtn).toBeInTheDocument();
    expect(openaiBtn).toBeInTheDocument();

    // 默认 provider = deepseek, h3 标题应是 "DeepSeek" (PROVIDER_META.deepseek.label)
    expect(screen.getByRole('heading', { name: 'DeepSeek' })).toBeInTheDocument();
    // "X models" 标签 (deepseek 有 2 个 model)
    expect(screen.getByText(/2 models/i)).toBeInTheDocument();
  });

  it('2. 点击 OpenAI provider 切换 activeProvider (header 标题变 "OpenAI")', async () => {
    const user = userEvent.setup();
    render(<ModelPicker onClose={vi.fn()} />);

    const sidebar = screen.getByText('Providers', { selector: 'p' }).parentElement!;
    const openaiBtn = within(sidebar.closest('aside')!).getByRole('button', { name: /OpenAI/i });
    await user.click(openaiBtn);

    // store 切到 openai
    expect(useSettingsStore.getState().defaultProvider).toBe('openai');

    // h3 标题变 "OpenAI"
    expect(screen.getByRole('heading', { name: 'OpenAI' })).toBeInTheDocument();
  });

  it('3. 切到 OpenClaw provider 时 defaultModel 自动跟到 openclaw-auto (setDefaultProvider 行为)', async () => {
    const user = userEvent.setup();
    render(<ModelPicker onClose={vi.fn()} />);

    const sidebar = screen.getByText('Providers', { selector: 'p' }).parentElement!;
    const openclawBtn = within(sidebar.closest('aside')!).getByRole('button', { name: /OpenClaw API/i });
    await user.click(openclawBtn);

    // store: provider 切到 openclaw, defaultModel 应该 follow 到 openclaw provider 的第一个 model (openclaw-auto)
    // (line 144-147 setDefaultProvider 逻辑: providerGroup 存在但当前 defaultModel 不在新 provider 里 → 切到 models[0])
    const state = useSettingsStore.getState();
    expect(state.defaultProvider).toBe('openclaw');
    expect(state.defaultModel).toBe('openclaw-auto');
  });

  it('4. 选具体 model 触发 setDefaultModel + 保留当前 provider', async () => {
    const user = userEvent.setup();
    render(<ModelPicker onClose={vi.fn()} />);

    // 默认 deepseek + deepseek-chat, model 列表显示 deepseek-chat + v4-pro
    // 选 "V4 Pro" (deepseek-v4-pro)
    const v4Pro = screen.getByRole('button', { name: /V4 Pro/i });
    await user.click(v4Pro);

    const state = useSettingsStore.getState();
    expect(state.defaultModel).toBe('deepseek-v4-pro');
    // provider 仍是 deepseek (切 model 不会改 provider)
    expect(state.defaultProvider).toBe('deepseek');
  });

  it('5. 切 speed 按钮 (default → fast)', async () => {
    const user = userEvent.setup();
    render(<ModelPicker onClose={vi.fn()} />);

    // 默认 modelSpeed = 'default'
    expect(useSettingsStore.getState().modelSpeed).toBe('default');

    // 找 "Fast" speed 按钮 (在 Speed section)
    const fastBtn = screen.getByRole('button', { name: /Fast/i });
    await user.click(fastBtn);

    expect(useSettingsStore.getState().modelSpeed).toBe<ModelSpeedMode>('fast');
  });

  it('6. 点击 Cancel 按钮触发 onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ModelPicker onClose={onClose} />);

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
