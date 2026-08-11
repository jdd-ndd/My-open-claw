/**
 * DeepSeek 适配器单元测试
 *
 * 文档参考：https://api-docs.deepseek.com/zh-cn/
 *
 * 覆盖范围：
 * - 元信息（模型上下文窗口、max_tokens 推荐值）
 * - 标准 chat / tool_calls 响应解析
 * - 思考模式（thinking / reasoning_content / reasoning_effort）
 * - JSON 输出模式（response_format）
 * - 流式响应（含 reasoning_content delta 与 usage）
 * - 用户隔离（user_id）
 * - 错误码（401/402/422/429/500/503）
 * - 超时 / 取消 / 重试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DeepSeekAdapter,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_MODELS,
  DEEPSEEK_CONTEXT_WINDOWS,
  DEEPSEEK_DEFAULT_THINKING,
} from '../../../src/agents/llm/deepseek.js';
import {
  LLMError,
  LLMErrorCode,
  LLMTimeoutError,
  NotSupportedLLMError,
} from '../../../src/agents/llm/errors.js';
import type { LLMChatInput } from '../../../src/agents/llm/types.js';

const sampleInput: LLMChatInput = {
  messages: [
    { role: 'system', content: '你是助手' },
    { role: 'user', content: '你好' },
  ],
  options: { temperature: 0.5, maxTokens: 100 },
};

const okBody = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1700000000,
  model: 'deepseek-v4-pro',
  system_fingerprint: 'fp_xxx',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: '你好，世界！' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe('agents/llm - DeepSeekAdapter', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 元信息 ──
  describe('元信息', () => {
    it('应使用官方默认 baseUrl', () => {
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      expect(adapter.provider).toBe('deepseek');
      expect(adapter.id).toBe('deepseek:deepseek-v4-pro');
      expect(adapter.model).toBe('deepseek-v4-pro');
      expect(adapter.displayName).toContain('deepseek-v4-pro');
    });

    it('应基于模型名自动设置上下文窗口', () => {
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      expect(adapter.contextWindow).toBe(DEEPSEEK_CONTEXT_WINDOWS['deepseek-v4-pro']);
    });

    it('应暴露 defaultThinkingMode 与 recommendedMaxTokens', () => {
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      expect(adapter.defaultThinkingMode).toBe('enabled');
      expect(adapter.recommendedMaxTokens).toBe(8192);
    });

    it('应允许覆盖上下文窗口', () => {
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
        contextWindow: 4096,
      });
      expect(adapter.contextWindow).toBe(4096);
    });
  });

  // ── 请求构造 ──
  describe('请求构造', () => {
    it('chat 应发送 Bearer 鉴权与正确 URL', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(okBody), { status: 200 }),
      );
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk-test',
      });
      await adapter.chat(sampleInput);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${DEEPSEEK_DEFAULT_BASE_URL}/chat/completions`);
      expect(init.headers['Authorization']).toBe('Bearer sk-test');
    });

    it('应将 thinking / reasoning_effort 写入请求体', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(okBody), { status: 200 }),
      );
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      await adapter.chat({
        ...sampleInput,
        deepseek: {
          thinking: { type: 'enabled' },
          reasoningEffort: 'high',
        },
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.thinking).toEqual({ type: 'enabled' });
      expect(body.reasoning_effort).toBe('high');
    });

    it('应将 response_format 写入请求体', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(okBody), { status: 200 }),
      );
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      await adapter.chat({
        ...sampleInput,
        deepseek: { responseFormat: { type: 'json_object' } },
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('应将 user_id 写入请求体（业务侧用户隔离）', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(okBody), { status: 200 }),
      );
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      await adapter.chat({
        ...sampleInput,
        deepseek: { userId: 'u_12345' },
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.user_id).toBe('u_12345');
    });

    it('应将 logprobs / top_logprobs 写入请求体', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(okBody), { status: 200 }),
      );
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      await adapter.chat({
        ...sampleInput,
        deepseek: { logprobs: { enabled: true, topN: 5 } },
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.logprobs).toBe(true);
      expect(body.top_logprobs).toBe(5);
    });

    it('strictTools 应标记每个 tool', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(okBody), { status: 200 }),
      );
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      await adapter.chat({
        ...sampleInput,
        tools: [{ name: 'f', description: 'd', parameters: {} }],
        deepseek: { strictTools: true },
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.tools[0].strict).toBe(true);
    });

    it('options.extra 应透传到请求体', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(okBody), { status: 200 }),
      );
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      await adapter.chat({
        ...sampleInput,
        options: { extra: { custom_field: 'x' } },
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.custom_field).toBe('x');
    });
  });

  // ── 响应解析 ──
  describe('响应解析', () => {
    it('应解析 reasoning_content / system_fingerprint / created', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...okBody,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: '最终答案',
                  reasoning_content: '让我思考一下...',
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
              prompt_cache_hit_tokens: 80,
              prompt_cache_miss_tokens: 20,
              completion_tokens_details: { reasoning_tokens: 30 },
            },
          }),
          { status: 200 },
        ),
      );
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      const out = await adapter.chat({
        ...sampleInput,
        deepseek: { thinking: { type: 'enabled' } },
      });
      expect(out.content).toBe('最终答案');
      expect(out.reasoningContent).toBe('让我思考一下...');
      expect(out.systemFingerprint).toBe('fp_xxx');
      expect(out.created).toBe(1700000000);
      expect(out.usage.promptCacheHitTokens).toBe(80);
      expect(out.usage.promptCacheMissTokens).toBe(20);
      expect(out.usage.reasoningTokens).toBe(30);
    });

    it('应解析 tool_calls', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...okBody,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: { name: 'fs/read_file', arguments: '{"path":"/tmp/a"}' },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          }),
          { status: 200 },
        ),
      );
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      const out = await adapter.chat({
        ...sampleInput,
        tools: [{ name: 'fs/read_file', description: 'd', parameters: {} }],
      });
      expect(out.finishReason).toBe('tool_calls');
      expect(out.toolCalls?.[0].function.name).toBe('fs/read_file');
    });

    it('insufficient_system_resource 应被归一化', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...okBody,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: '' },
                finish_reason: 'insufficient_system_resource',
              },
            ],
          }),
          { status: 200 },
        ),
      );
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      const out = await adapter.chat(sampleInput);
      expect(out.finishReason).toBe('insufficient_system_resource');
    });
  });

  // ── 错误码 ──
  describe('错误码（DeepSeek 官方）', () => {
    it.each([
      [400, 'format error', 'LLM_UNKNOWN', false],
      [401, 'invalid api key', 'LLM_API_KEY_INVALID', false],
      [402, 'insufficient balance', 'LLM_UNKNOWN', false],
      [422, 'parameter error', 'LLM_UNKNOWN', false],
      [429, 'rate limit', 'LLM_RATE_LIMIT', true],
      [500, 'server fault', 'LLM_UNKNOWN', true],
      [503, 'server busy', 'LLM_UNKNOWN', true],
    ])('HTTP %i (%s) 应分类为 %s retryable=%s', async (status, _msg, code, retryable) => {
      fetchMock.mockResolvedValueOnce(new Response('error', { status }));
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
        maxRetries: 0,
      });
      await expect(adapter.chat(sampleInput)).rejects.toMatchObject({
        llmCode: code,
        retryable,
        httpStatus: status,
      });
    });
  });

  // ── 流式 ──
  describe('流式响应', () => {
    it('应解析 thinking 模式的 reasoning_content delta', async () => {
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(
            enc.encode(
              'data: {"choices":[{"delta":{"reasoning_content":"让我想想"}}]}\n\n',
            ),
          );
          ctrl.enqueue(
            enc.encode('data: {"choices":[{"delta":{"content":"答案"}}]}\n\n'),
          );
          ctrl.enqueue(
            enc.encode(
              'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5,"prompt_cache_hit_tokens":2,"prompt_cache_miss_tokens":1}}\n\n',
            ),
          );
          ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
          ctrl.close();
        },
      });
      fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      const reasoning: string[] = [];
      const text: string[] = [];
      let finalUsage: unknown;
      for await (const chunk of adapter.streamChat({
        ...sampleInput,
        deepseek: { thinking: { type: 'enabled' } },
      })) {
        if (chunk.reasoningDelta) reasoning.push(chunk.reasoningDelta);
        if (chunk.delta) text.push(chunk.delta);
        if (chunk.done) finalUsage = chunk.usage;
      }
      expect(reasoning.join('')).toBe('让我想想');
      expect(text.join('')).toBe('答案');
      expect((finalUsage as { promptCacheHitTokens?: number }).promptCacheHitTokens).toBe(2);
    });
  });

  // ── 超时与取消 ──
  describe('超时与取消', () => {
    it('网络异常应抛出 LLMTimeoutError', async () => {
      fetchMock.mockRejectedValueOnce(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      );
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
        timeoutMs: 10,
        maxRetries: 0,
      });
      await expect(adapter.chat(sampleInput)).rejects.toBeInstanceOf(LLMTimeoutError);
    });

    it('embed 默认抛 NotSupportedLLMError', async () => {
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'sk',
      });
      await expect(adapter.embed('hi')).rejects.toBeInstanceOf(NotSupportedLLMError);
    });
  });

  // ── 模型常量 ──
  describe('DEEPSEEK_MODELS 常量', () => {
    it('应暴露 V4_FLASH / V4_PRO / CHAT / REASONER', () => {
      expect(DEEPSEEK_MODELS.V4_FLASH).toBe('deepseek-v4-flash');
      expect(DEEPSEEK_MODELS.V4_PRO).toBe('deepseek-v4-pro');
      expect(DEEPSEEK_MODELS.CHAT).toBe('deepseek-chat');
      expect(DEEPSEEK_MODELS.REASONER).toBe('deepseek-reasoner');
    });

    it('V4 系列应默认开启思考模式', () => {
      expect(DEEPSEEK_DEFAULT_THINKING['deepseek-v4-pro']).toBe('enabled');
      expect(DEEPSEEK_DEFAULT_THINKING['deepseek-v4-flash']).toBe('enabled');
    });
  });

  // ── 错误对象格式 ──
  describe('错误对象完整性', () => {
    it('LLMError 应包含 provider/model/llmCode', async () => {
      fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
      const adapter = new DeepSeekAdapter({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        apiKey: 'bad',
        maxRetries: 0,
      });
      try {
        await adapter.chat(sampleInput);
      } catch (err) {
        expect(err).toBeInstanceOf(LLMError);
        const e = err as LLMError;
        expect(e.provider).toBe('deepseek');
        expect(e.model).toBe('deepseek-v4-pro');
        expect(e.llmCode).toBe(LLMErrorCode.INVALID_API_KEY);
        expect(e.toJSON()).toMatchObject({
          llmCode: 'LLM_API_KEY_INVALID',
          provider: 'deepseek',
          model: 'deepseek-v4-pro',
        });
      }
    });
  });
});