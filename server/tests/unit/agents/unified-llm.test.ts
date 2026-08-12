/**
 * UnifiedLLMAdapter 单元测试
 */
import { describe, it, expect, vi } from 'vitest';
import { UnifiedLLMAdapter } from '../../../src/agents/llm/llm-adapter.js';
import { LLMError, LLMErrorCode } from '../../../src/agents/llm/errors.js';
import type { LLMAdapter, LLMChatInput, LLMChatOutput } from '../../../src/agents/llm/types.js';

function makeMockAdapter(overrides: Partial<LLMAdapter> & {
  chatImpl?: (input: LLMChatInput) => Promise<LLMChatOutput>;
}): LLMAdapter {
  return {
    id: overrides.id ?? 'mock',
    displayName: overrides.displayName ?? 'Mock',
    provider: overrides.provider ?? 'custom',
    model: overrides.model ?? 'mock-model',
    supportsToolCalls: overrides.supportsToolCalls ?? true,
    supportsStreaming: overrides.supportsStreaming ?? true,
    contextWindow: overrides.contextWindow ?? 4096,
    chat: overrides.chatImpl ?? (async () => ({
      content: 'ok',
      finishReason: 'stop' as const,
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: 'mock-model',
    })),
    async *streamChat() {
      yield { delta: 'ok', done: true };
    },
    async embed() {
      return [];
    },
    async countTokens() {
      return 0;
    },
  };
}

describe('agents/llm - UnifiedLLMAdapter', () => {
  it('应使用主适配器的元信息', () => {
    const primary = makeMockAdapter({ id: 'p', displayName: 'Primary' });
    const unified = new UnifiedLLMAdapter({ primary });
    expect(unified.id).toBe('p');
    expect(unified.displayName).toBe('Primary');
    expect(unified.getPrimary()).toBe(primary);
    expect(unified.getFallbacks()).toHaveLength(0);
  });

  it('有备用适配器时显示名称应包含提示', () => {
    const primary = makeMockAdapter({ id: 'p' });
    const fallback = makeMockAdapter({ id: 'f' });
    const unified = new UnifiedLLMAdapter({ primary, fallbacks: [fallback] });
    expect(unified.displayName).toContain('+1');
  });

  it('主适配器成功时应直接返回', async () => {
    const primary = makeMockAdapter({});
    const fallback = makeMockAdapter({});
    const unified = new UnifiedLLMAdapter({ primary, fallbacks: [fallback] });
    const out = await unified.chat({ messages: [] });
    expect(out.content).toBe('ok');
  });

  it('主适配器失败且可重试时应回退到备用', async () => {
    const primary = makeMockAdapter({
      chatImpl: async () => {
        throw new LLMError({ code: LLMErrorCode.RATE_LIMIT, message: 'rl', retryable: true });
      },
    });
    const fallback = makeMockAdapter({});
    const unified = new UnifiedLLMAdapter({ primary, fallbacks: [fallback] });
    const out = await unified.chat({ messages: [] });
    expect(out.content).toBe('ok');
  });

  it('主适配器失败且不可重试时应直接抛错，不回退', async () => {
    const primary = makeMockAdapter({
      chatImpl: async () => {
        throw new LLMError({ code: LLMErrorCode.INVALID_API_KEY, message: 'bad', retryable: false });
      },
    });
    const fallback = makeMockAdapter({
      chatImpl: async () => ({ content: 'fb', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: 'm' }),
    });
    const unified = new UnifiedLLMAdapter({ primary, fallbacks: [fallback] });
    await expect(unified.chat({ messages: [] })).rejects.toMatchObject({
      llmCode: LLMErrorCode.INVALID_API_KEY,
    });
  });

  it('所有适配器均失败时应抛出最后一个错误', async () => {
    const primary = makeMockAdapter({
      chatImpl: async () => {
        throw new LLMError({ code: LLMErrorCode.RATE_LIMIT, message: 'rl1', retryable: true });
      },
    });
    const fallback = makeMockAdapter({
      chatImpl: async () => {
        throw new LLMError({ code: LLMErrorCode.NETWORK, message: 'net', retryable: true });
      },
    });
    const unified = new UnifiedLLMAdapter({ primary, fallbacks: [fallback] });
    await expect(unified.chat({ messages: [] })).rejects.toMatchObject({
      llmCode: LLMErrorCode.NETWORK,
    });
  });

  it('enableFallback=false 时不应回退', async () => {
    const primary = makeMockAdapter({
      chatImpl: async () => {
        throw new LLMError({ code: LLMErrorCode.RATE_LIMIT, message: 'rl', retryable: true });
      },
    });
    const fallback = makeMockAdapter({
      chatImpl: async () => ({ content: 'fb', finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: 'm' }),
    });
    const unified = new UnifiedLLMAdapter({ primary, fallbacks: [fallback], enableFallback: false });
    await expect(unified.chat({ messages: [] })).rejects.toMatchObject({
      llmCode: LLMErrorCode.RATE_LIMIT,
    });
  });

  it('embed/countTokens 应委托主适配器', async () => {
    const embedSpy = vi.fn(async () => [0.1, 0.2]);
    const countSpy = vi.fn(async () => 7);
    const primary = makeMockAdapter({});
    (primary as any).embed = embedSpy;
    (primary as any).countTokens = countSpy;
    const unified = new UnifiedLLMAdapter({ primary });
    expect(await unified.embed('x')).toEqual([0.1, 0.2]);
    expect(await unified.countTokens('hello')).toBe(7);
  });

  it('缺少主适配器时构造应抛错', () => {
    expect(() => new UnifiedLLMAdapter({ primary: undefined as unknown as LLMAdapter })).toThrow(LLMError);
  });

  describe('aggregate', () => {
    it('应汇总多个 TokenUsage', () => {
      const total = UnifiedLLMAdapter.aggregate([
        { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      ]);
      expect(total.promptTokens).toBe(15);
      expect(total.completionTokens).toBe(25);
      expect(total.totalTokens).toBe(40);
    });

    it('空数组应返回零值', () => {
      const total = UnifiedLLMAdapter.aggregate([]);
      expect(total.promptTokens).toBe(0);
    });
  });

  describe('流式对话', () => {
    it('supportsStreaming=false 时应抛错', async () => {
      const primary = makeMockAdapter({ supportsStreaming: false });
      const unified = new UnifiedLLMAdapter({ primary });
      const iter = unified.streamChat({ messages: [] });
      await expect(iter.next()).rejects.toThrow(LLMError);
    });

    it('主适配器流式成功时应正确产出', async () => {
      async function* gen() {
        yield { delta: 'a', done: false };
        yield { delta: 'b', done: false };
        yield { delta: '', done: true, usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } };
      }
      const primary = makeMockAdapter({});
      (primary as any).streamChat = () => gen();
      const unified = new UnifiedLLMAdapter({ primary });
      const chunks: string[] = [];
      for await (const chunk of unified.streamChat({ messages: [] })) {
        if (chunk.delta) chunks.push(chunk.delta);
      }
      expect(chunks.join('')).toBe('ab');
    });
  });
});