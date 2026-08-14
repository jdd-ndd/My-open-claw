// v1.2.0: 扩 Web 组件测试. MessageBubble 渲染 + role 分支 + final_answer 提取.
// v1.2.2: 补 reasoning / tool call / tool result / file / image / error 状态路径.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  // v1.2.2: 补 ContentBlock 其他类型 + reasoning + error 路径

  it('5. image block 渲染 <img> with url + alt=图片', () => {
    render(
      <MessageBubble
        message={makeMessage({
          role: 'user',
          content: [{ type: 'image', url: 'https://example.com/photo.png', mimeType: 'image/png' }],
        })}
      />,
    );
    const img = screen.getByRole('img', { name: '图片' });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/photo.png');
  });

  it('6. file block 渲染 <a> with name + size KB + mimeType', () => {
    render(
      <MessageBubble
        message={makeMessage({
          role: 'user',
          content: [
            { type: 'file', name: 'design.pdf', url: '/uploads/design.pdf', size: 10240, mimeType: 'application/pdf' },
          ],
        })}
      />,
    );
    const link = screen.getByRole('link', { name: /design\.pdf/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/uploads/design.pdf');
    expect(link).toHaveAttribute('target', '_blank');
    // size 10240 bytes / 1024 = 10.0 KB
    expect(link.textContent).toMatch(/10\.0 KB/);
    expect(link.textContent).toMatch(/application\/pdf/);
  });

  it('7. tool_call block 渲染 "调用工具" + toolName + arguments JSON', () => {
    render(
      <MessageBubble
        message={makeMessage({
          role: 'assistant',
          content: [
            {
              type: 'tool_call',
              toolName: 'calculator',
              arguments: { op: 'add', a: 1, b: 2 },
            },
          ],
        })}
      />,
    );
    expect(screen.getByText(/调用工具: calculator/)).toBeInTheDocument();
    // arguments JSON 渲染到 <pre>
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toContain('"op"');
    expect(pre?.textContent).toContain('"add"');
  });

  it('8. tool_result block (success) 渲染绿色 "工具结果" + result 文本', () => {
    render(
      <MessageBubble
        message={makeMessage({
          role: 'assistant',
          content: [
            { type: 'tool_result', toolName: 'calculator', result: '3', success: true },
          ],
        })}
      />,
    );
    expect(screen.getByText(/工具结果: calculator/)).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('9. assistant + reasoning 字段渲染折叠 "思考过程" 按钮 + 点击展开内容', async () => {
    const user = userEvent.setup();
    render(
      <MessageBubble
        message={makeMessage({
          role: 'assistant',
          content: [{ type: 'text', text: 'final answer' }],
          reasoning: 'thinking step by step...',
          reasoningDurationMs: 3500,
        })}
      />,
    );

    // 折叠态: 按钮可见, reasoning 内容不直接出现 (因为 button toggle 内部 div)
    const toggleBtn = screen.getByRole('button', { name: /思考过程/i });
    expect(toggleBtn).toBeInTheDocument();
    // duration 显示: 3500ms / 1000 = 4s (Math.max(1, Math.round(3.5)) = 4)
    expect(toggleBtn.textContent).toMatch(/4s/);
    // reasoning 文字未展开
    expect(screen.queryByText('thinking step by step...')).not.toBeInTheDocument();

    // 点击展开
    await user.click(toggleBtn);
    expect(screen.getByText('thinking step by step...')).toBeInTheDocument();
  });

  it('10. status=error 渲染错误图标 + error message + 错误样式', () => {
    render(
      <MessageBubble
        message={makeMessage({
          role: 'user',
          content: [{ type: 'text', text: 'failed msg' }],
          status: 'error',
          error: 'network timeout',
        })}
      />,
    );
    expect(screen.getByText('network timeout')).toBeInTheDocument();
    // 错误态: 红色 ring/border 出现在 message-bubble 容器上
    const bubble = document.querySelector('.message-bubble-user');
    expect(bubble?.className).toMatch(/ring-red/);
  });
});
