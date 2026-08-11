/**
 * Claude 适配器单元测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClaudeAdapter } from '../../../src/agents/llm/claude.js';
import { LLMError, LLMErrorCode, NotSupportedLLMError } from '../../../src/agents/llm/errors.js';
import type { LLMChatInput } from '../../../src/agents/llm/types.js';

const input: LLMChatInput = {
  messages: [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '你好' },
  ],
};

const okBody = {
  id: 'msg_1',
  model: 'claude-3-5-sonnet-20241022',
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: '你好，我是 Claude' }],
  usage: { input_tokens: 12, output_tokens: 8 },
};

describe('agents/llm - ClaudeAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('应正确暴露元信息', () => {
    const adapter = new ClaudeAdapter({
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'sk-ant-test',
    });
    expect(adapter.provider).toBe('claude');
    expect(adapter.id).toBe('claude:claude-3-5-sonnet-20241022');
    expect(adapter.supportsToolCalls).toBe(true);
    expect(adapter.supportsStreaming).toBe(true);
    expect(adapter.contextWindow).toBe(200_000);
  });

  it('chat 应发送到 Anthropic /messages 端点', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okBody), { status: 200 }),
    );
    const adapter = new ClaudeAdapter({
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'sk-ant',
    });
    const out = await adapter.chat(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('claude-3-5-sonnet-20241022');
    expect(body.system).toBe('你是助手');
    expect(body.messages).toEqual([{ role: 'user', content: '你好' }]);
    expect(body.max_tokens).toBe(4096);

    expect(out.content).toBe('你好，我是 Claude');
    expect(out.finishReason).toBe('stop');
    expect(out.usage.promptTokens).toBe(12);
    expect(out.usage.completionTokens).toBe(8);
  });

  it('tool_use 块应解析为 toolCalls', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'msg_2',
          model: 'claude-3-5-sonnet-20241022',
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'fs/read_file',
              input: { path: '/tmp/a' },
            },
          ],
          usage: { input_tokens: 5, output_tokens: 5 },
        }),
        { status: 200 },
      ),
    );
    const adapter = new ClaudeAdapter({
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'sk',
      maxRetries: 0,
    });
    const out = await adapter.chat({
      ...input,
      tools: [
        { name: 'fs/read_file', description: 'read', parameters: { type: 'object' } },
      ],
    });
    expect(out.finishReason).toBe('tool_calls');
    expect(out.toolCalls?.[0].function.name).toBe('fs/read_file');
    expect(out.toolCalls?.[0].function.arguments).toBe('{"path":"/tmp/a"}');
  });

  it('HTTP 401 应分类为 INVALID_API_KEY', async () => {
    fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 401 }));
    const adapter = new ClaudeAdapter({
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'bad',
      maxRetries: 0,
    });
    await expect(adapter.chat(input)).rejects.toMatchObject({
      llmCode: LLMErrorCode.INVALID_API_KEY,
    });
  });

  it('HTTP 500 应可重试', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const adapter = new ClaudeAdapter({
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'sk',
      maxRetries: 1,
    });
    await expect(adapter.chat(input)).rejects.toBeInstanceOf(LLMError);
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it('embed 应抛 NotSupportedLLMError', async () => {
    const adapter = new ClaudeAdapter({
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'sk',
    });
    await expect(adapter.embed('hi')).rejects.toBeInstanceOf(NotSupportedLLMError);
  });

  it('应允许自定义 baseUrl', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okBody), { status: 200 }),
    );
    const adapter = new ClaudeAdapter({
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'sk',
      baseUrl: 'https://proxy.example.com',
    });
    await adapter.chat(input);
    expect(fetchMock.mock.calls[0][0]).toContain('https://proxy.example.com/messages');
  });

  it('流式响应应解析 text_delta 与 message_stop', async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(enc.encode('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":3,"output_tokens":0}}}\n\n'));
        ctrl.enqueue(enc.encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}\n\n'));
        ctrl.enqueue(enc.encode('event: message_delta\ndata: {"type":"message_delta","message":{"usage":{"output_tokens":5}}}\n\n'));
        ctrl.enqueue(enc.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
        ctrl.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    const adapter = new ClaudeAdapter({
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'sk',
    });
    const collected: string[] = [];
    let usageSeen = false;
    for await (const chunk of adapter.streamChat(input)) {
      if (chunk.delta) collected.push(chunk.delta);
      if (chunk.done && chunk.usage) usageSeen = true;
    }
    expect(collected.join('')).toBe('你好');
    expect(usageSeen).toBe(true);
  });

  it('流式响应 HTTP 错误应抛出 LLMError', async () => {
    fetchMock.mockResolvedValueOnce(new Response('rate limit', { status: 429 }));
    const adapter = new ClaudeAdapter({
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'sk',
    });
    const iter = adapter.streamChat(input);
    await expect(iter.next()).rejects.toMatchObject({
      llmCode: LLMErrorCode.RATE_LIMIT,
    });
  });

  it('流式响应无 body 应抛错', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const adapter = new ClaudeAdapter({
      provider: 'claude',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'sk',
    });
    const iter = adapter.streamChat(input);
    await expect(iter.next()).rejects.toMatchObject({
      llmCode: LLMErrorCode.INVALID_RESPONSE,
    });
  });
});