// v1.2.4: 扩 Web 组件测试. MessageInput 渲染 + 发送 + file upload + 移除.
// 覆盖: 渲染 / Enter 提交 / file upload / 移除 file / trim 空不提交.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageInput } from './MessageInput';

// ─── Mock 依赖 ───────────────────────────────────────────

// useSkills 拉 skills/tools 元数据, mock 掉避免真实 API 调用
vi.mock('@/hooks/useSkills', () => ({
  useSkills: () => ({ skills: [], tools: [] }),
}));

// SkillPanel 复杂弹出层, mock 掉避免渲染
vi.mock('./SkillPanel', () => ({
  SkillPanel: () => <div data-testid="mock-skill-panel">SkillPanel</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// helper: 模拟 file input 选择
// jsdom 24 不支持 `new DataTransfer()`, 用 Object.defineProperty 绕过
async function uploadFile(input: HTMLInputElement, file: File) {
  const files = [file] as unknown as FileList;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// ─── 测试 ───────────────────────────────────────────────

describe('MessageInput 渲染 + 发送', () => {
  it('1. 渲染 textarea + 4 个 button (技能/附件/发送) + 占位符', () => {
    render(<MessageInput onSend={vi.fn()} placeholder="请输入" />);

    // textarea
    expect(screen.getByPlaceholderText('请输入')).toBeInTheDocument();

    // 4 个 button: 技能 (LayoutGrid) / 附件 (Paperclip) / 发送 (Send) — disabled 时只有这 3 个
    // 实际可见 button: 技能 + 附件 + 发送 = 3 个 (stop button 是 isStreaming 时)
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    // 通过 title 区分
    expect(screen.getByTitle('技能与工具')).toBeInTheDocument();
    expect(screen.getByTitle('添加附件')).toBeInTheDocument();
    expect(screen.getByTitle('发送')).toBeInTheDocument();
  });

  it('2. 输入文字 + Enter 触发 onSend (无 file 无 chip)', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hello world');
    await user.keyboard('{Enter}');

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('hello world', undefined, {});

    // 发送后 textarea 清空
    expect(textarea).toHaveValue('');
  });

  it('3. 点击发送按钮触发 onSend', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hi');

    // 发送按钮 (title=发送) 不应该 disabled
    const sendBtn = screen.getByTitle('发送');
    expect(sendBtn).not.toBeDisabled();
    await user.click(sendBtn);

    expect(onSend).toHaveBeenCalledWith('hi', undefined, {});
  });

  it('4. trim 后为空 + 无 file + 无 chip → 不调 onSend (Enter no-op)', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    const textarea = screen.getByRole('textbox');
    // 只输入空格
    await user.type(textarea, '   ');
    await user.keyboard('{Enter}');

    expect(onSend).not.toHaveBeenCalled();
    // textarea 保留空格 (没清空因为没发送)
    expect(textarea).toHaveValue('   ');
  });

  it('5. disabled=true 时发送按钮 disabled, Enter no-op', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={true} />);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hi');
    // 发送按钮 disabled
    expect(screen.getByTitle('发送')).toBeDisabled();
    // Enter 也不调 onSend (因 disabled)
    await user.keyboard('{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('6. 模拟文件选择 → file preview 显示文件名 + X 按钮', async () => {
    render(<MessageInput onSend={vi.fn()} />);

    // 找隐藏的 file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    // 模拟选 1 个文件
    const file = new File(['content'], 'design.pdf', { type: 'application/pdf' });
    await uploadFile(fileInput, file);

    // file preview 显示文件名
    await waitFor(() => {
      expect(screen.getByText('design.pdf')).toBeInTheDocument();
    });
    // X 按钮 (title=移除附件) 出现
    expect(screen.getByTitle('移除附件')).toBeInTheDocument();
  });

  it('7. 点击 X 按钮移除文件预览', async () => {
    const user = userEvent.setup();
    render(<MessageInput onSend={vi.fn()} />);

    // 上传 1 个文件
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await uploadFile(fileInput, new File(['x'], 'report.txt', { type: 'text/plain' }));
    await waitFor(() => {
      expect(screen.getByText('report.txt')).toBeInTheDocument();
    });

    // 点击 X 移除
    const removeBtn = screen.getByTitle('移除附件');
    await user.click(removeBtn);

    // preview 消失
    await waitFor(() => {
      expect(screen.queryByText('report.txt')).not.toBeInTheDocument();
    });
  });

  it('8. 仅 file (无文字) + Enter → onSend 调 + 传 files 参数', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} />);

    // 上传文件
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await uploadFile(fileInput, new File(['data'], 'note.txt', { type: 'text/plain' }));

    // 等文件 preview 出现 (说明 state 更新)
    await waitFor(() => {
      expect(screen.getByText('note.txt')).toBeInTheDocument();
    });

    // Enter 发送 (textarea 空, 但 files 非空)
    const textarea = screen.getByRole('textbox');
    await user.click(textarea); // focus
    await user.keyboard('{Enter}');

    expect(onSend).toHaveBeenCalledTimes(1);
    const [content, files] = onSend.mock.calls[0];
    expect(content).toBe('');
    expect(files).toBeInstanceOf(Array);
    expect(files).toHaveLength(1);
    expect((files as File[])[0].name).toBe('note.txt');

    // 发送后 file preview 清空
    await waitFor(() => {
      expect(screen.queryByText('note.txt')).not.toBeInTheDocument();
    });
  });
});
