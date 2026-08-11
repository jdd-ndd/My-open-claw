/**
 * OpenAI / Local 适配器单元测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIAdapter } from '../../../src/agents/llm/openai.js';
import { LocalLLMAdapter } from '../../../src/agents/llm/local.js';
import { LLMError } from '../../../src/agents/llm/errors.js';
import type { LLMChatInput } from '../../../src/agents/llm/types.js';

const input: LLMChatInput = {
  messages: [{ role: 'user', content: 'hello' }],
};

const okBody = {
  id: 'x',
  model: 'gpt-4o',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

describe('agents/llm - OpenAIAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it('应使用官方默认地址', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okBody), { status: 200 }),
    );
    const adapter = new OpenAIAdapter({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk' });
    await adapter.chat(input);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('应正确解析响应', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okBody), { status: 200 }),
    );
    const adapter = new OpenAIAdapter({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk' });
    const out = await adapter.chat(input);
    expect(out.content).toBe('hi');
    expect(out.usage.totalTokens).toBe(2);
  });

  it('HTTP 500 应触发重试', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const adapter = new OpenAIAdapter({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk',
      maxRetries: 1,
    });
    await expect(adapter.chat(input)).rejects.toBeInstanceOf(LLMError);
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it('未知模型应使用默认上下文窗口', () => {
    const adapter = new OpenAIAdapter({
      provider: 'openai',
      model: 'gpt-unknown',
      apiKey: 'sk',
    });
    expect(adapter.contextWindow).toBe(16_385);
  });
});

describe('agents/llm - LocalLLMAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it('应使用 Ollama 默认地址', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...okBody, model: 'llama3.1:8b' }), { status: 200 }),
    );
    const adapter = new LocalLLMAdapter({
      provider: 'local',
      model: 'llama3.1:8b',
    });
    await adapter.chat(input);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('默认不支持 tool calls', () => {
    const adapter = new LocalLLMAdapter({ provider: 'local', model: 'llama3.1:8b' });
    expect(adapter.supportsToolCalls).toBe(false);
  });

  it('可显式开启 tool calls 支持', () => {
    const adapter = new LocalLLMAdapter({
      provider: 'local',
      model: 'llama3.1:8b',
      supportsToolCalls: true,
    });
    expect(adapter.supportsToolCalls).toBe(true);
  });

  it('未传 apiKey 时使用 ollama 默认占位', () => {
    const adapter = new LocalLLMAdapter({ provider: 'local', model: 'llama3.1:8b' });
    // 通过调用验证 Authorization 头存在
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...okBody, model: 'llama3.1:8b' }), { status: 200 }),
    );
    return adapter.chat(input).then(() => {
      const init = fetchMock.mock.calls[0][1];
      expect(init.headers['Authorization']).toBe('Bearer ollama');
    });
  });

  it('应允许自定义 baseUrl', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(okBody), { status: 200 }),
    );
    const adapter = new LocalLLMAdapter({
      provider: 'local',
      model: 'qwen2.5:7b',
      baseUrl: 'http://gpu-host:11434/v1',
    });
    await adapter.chat(input);
    expect(fetchMock.mock.calls[0][0]).toBe('http://gpu-host:11434/v1/chat/completions');
  });
});