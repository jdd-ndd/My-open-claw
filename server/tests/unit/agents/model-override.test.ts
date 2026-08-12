/**
 * P1.3: 验证 input.options.model 在 buildRequest 时覆盖 this.model
 *
 * 关键场景: TUI 切 model 时, 同一 adapter (同 provider) 内
 * 换档 (deepseek-v4-pro -> deepseek-v4-flash), 不重建 adapter.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseOpenAICompatibleAdapter } from '../../../src/agents/llm/base-http-adapter.js';
import type { LLMAdapterConfig } from '../../../src/agents/llm/types.js';

class TestAdapter extends BaseOpenAICompatibleAdapter {
  constructor(cfg: LLMAdapterConfig) {
    super({
      id: 'test',
      displayName: 'Test',
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl ?? 'https://test.example.com/v1',
      timeoutMs: cfg.timeoutMs,
    });
  }
}

function okResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      id: 'x',
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    }),
    { status: 200 },
  );
}

describe('agents/llm - P1.3 input.options.model override', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it('input.options.model 覆盖 this.model (deepseek-v4-pro -> deepseek-v4-flash)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('hi'));
    const adapter = new TestAdapter({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: 'sk',
    });
    await adapter.chat({
      messages: [{ role: 'user', content: 'ping' }],
      options: { model: 'deepseek-v4-flash' },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('deepseek-v4-flash');
  });

  it('不传 input.options.model 时, 沿用 this.model', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('hi'));
    const adapter = new TestAdapter({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: 'sk',
    });
    await adapter.chat({
      messages: [{ role: 'user', content: 'ping' }],
      options: { temperature: 0.5 },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('deepseek-v4-pro');
  });

  it('input.options.model 跟其他 options 字段一并生效', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('hi'));
    const adapter = new TestAdapter({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: 'sk',
    });
    await adapter.chat({
      messages: [{ role: 'user', content: 'ping' }],
      options: {
        model: 'deepseek-v4-flash',
        temperature: 0.3,
        maxTokens: 1024,
      },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(1024);
  });

  it('流式请求也支持 model 覆盖 (streamChat)', async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const c of sseChunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

    const adapter = new TestAdapter({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: 'sk',
    });
    // 消耗 stream 触发 fetch
    for await (const chunk of adapter.streamChat({
      messages: [{ role: 'user', content: 'ping' }],
      options: { model: 'deepseek-v4-flash' },
    })) {
      void chunk; // drain
    }
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('deepseek-v4-flash');
    expect(body.stream).toBe(true);
  });
});
