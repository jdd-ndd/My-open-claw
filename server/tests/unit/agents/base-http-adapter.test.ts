/**
 * BaseOpenAICompatibleAdapter 流式与边界测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BaseOpenAICompatibleAdapter } from '../../../src/agents/llm/base-http-adapter.js';
import { LLMError, LLMErrorCode } from '../../../src/agents/llm/errors.js';
import type {
  LLMAdapterConfig,
  LLMChatInput,
} from '../../../src/agents/llm/types.js';

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
      maxRetries: cfg.maxRetries,
    });
  }
}

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe('agents/llm - BaseOpenAICompatibleAdapter (流式 / 边界)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it('supportsStreaming=false 时 streamChat 应抛错', async () => {
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk',
      supportsStreaming: false,
    });
    const iter = adapter.streamChat({ messages: [] });
    await expect(iter.next()).rejects.toThrow(LLMError);
  });

  it('流式响应应解析 delta 与 [DONE] 终止', async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    fetchMock.mockResolvedValueOnce(
      new Response(makeStream(sseChunks), { status: 200 }),
    );
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk',
    });
    const collected: string[] = [];
    for await (const chunk of adapter.streamChat({ messages: [] })) {
      if (chunk.delta) collected.push(chunk.delta);
      if (chunk.done && chunk.usage) {
        expect(chunk.usage).toBeDefined();
      }
    }
    expect(collected.join('')).toBe('你好');
  });

  it('流式响应中包含 tool_call delta', async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"f","arguments":"{\\"a\\":1}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    fetchMock.mockResolvedValueOnce(
      new Response(makeStream(sseChunks), { status: 200 }),
    );
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk',
    });
    let toolDelta: unknown;
    for await (const chunk of adapter.streamChat({ messages: [] })) {
      if (chunk.toolCallDelta) toolDelta = chunk.toolCallDelta;
    }
    expect(toolDelta).toBeDefined();
  });

  it('流式响应包含 finish_reason 应归一化为 stop', async () => {
    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n',
    ];
    fetchMock.mockResolvedValueOnce(
      new Response(makeStream(sseChunks), { status: 200 }),
    );
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk',
    });
    let finalChunk: any;
    for await (const chunk of adapter.streamChat({ messages: [] })) {
      if (chunk.done) finalChunk = chunk;
    }
    expect(finalChunk.finishReason).toBe('stop');
  });

  it('流式响应 HTTP 错误应抛出 LLMError', async () => {
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk',
      maxRetries: 0,
    });
    const iter = adapter.streamChat({ messages: [] });
    await expect(iter.next()).rejects.toMatchObject({
      llmCode: LLMErrorCode.RATE_LIMIT,
    });
  });

  it('流式响应无 body 应抛错', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk',
    });
    const iter = adapter.streamChat({ messages: [] });
    await expect(iter.next()).rejects.toMatchObject({
      llmCode: LLMErrorCode.INVALID_RESPONSE,
    });
  });

  it('网络异常应包装为 LLMError', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk',
      maxRetries: 0,
    });
    await expect(adapter.chat({ messages: [] })).rejects.toMatchObject({
      llmCode: LLMErrorCode.NETWORK,
      retryable: true,
    });
  });

  it('应剥离 baseUrl 末尾斜杠', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'x',
          model: 'm',
          choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
        }),
        { status: 200 },
      ),
    );
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk',
      baseUrl: 'https://x.example.com/v1///',
    });
    await adapter.chat({ messages: [] });
    expect(fetchMock.mock.calls[0][0]).toBe('https://x.example.com/v1/chat/completions');
  });

  it('响应无 choices 应抛 INVALID_RESPONSE', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'x', model: 'm' }), { status: 200 }),
    );
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk',
      maxRetries: 0,
    });
    await expect(adapter.chat({ messages: [] })).rejects.toMatchObject({
      llmCode: LLMErrorCode.INVALID_RESPONSE,
    });
  });

  it('usage 缺字段时应回填为 0', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'x',
          model: 'm',
          choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
          usage: {},
        }),
        { status: 200 },
      ),
    );
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk',
    });
    const out = await adapter.chat({ messages: [] });
    expect(out.usage.promptTokens).toBe(0);
    expect(out.usage.completionTokens).toBe(0);
    expect(out.usage.totalTokens).toBe(0);
  });

  it('content_filter 应归一化为 content_filter', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'x',
          model: 'm',
          choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'content_filter' }],
        }),
        { status: 200 },
      ),
    );
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk',
    });
    const out = await adapter.chat({ messages: [] });
    expect(out.finishReason).toBe('content_filter');
  });

  it('length 应归一化为 length', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'x',
          model: 'm',
          choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'length' }],
        }),
        { status: 200 },
      ),
    );
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk',
    });
    const out = await adapter.chat({ messages: [] });
    expect(out.finishReason).toBe('length');
  });

  it('不应在没有 apiKey 时发送 Authorization 头', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'x',
          model: 'm',
          choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
        }),
        { status: 200 },
      ),
    );
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
    });
    await adapter.chat({ messages: [] });
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers['Authorization']).toBeUndefined();
  });

  it('多模态内容应正确转换', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'x',
          model: 'm',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
        { status: 200 },
      ),
    );
    const adapter = new TestAdapter({
      provider: 'openai',
      model: 'm',
      apiKey: 'sk',
    });
    const input: LLMChatInput = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '描述图片' },
            { type: 'image_url', imageUrl: { url: 'https://x/a.jpg' } },
          ],
        },
      ],
    };
    await adapter.chat(input);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Array.isArray(body.messages[0].content)).toBe(true);
    expect(body.messages[0].content[1].type).toBe('image_url');
  });
});