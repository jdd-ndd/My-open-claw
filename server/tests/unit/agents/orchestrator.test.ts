/**
 * AgentOrchestrator 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentOrchestrator } from '../../../src/agents/orchestrator.js';
import type { LLMAdapter, LLMChatInput, LLMChatOutput } from '../../../src/agents/llm/types.js';
import { SessionMemory } from '../../../src/memory/session.js';
import { VectorMemory } from '../../../src/memory/vector.js';
import { PersistLayer } from '../../../src/memory/persist.js';
import { EmbeddingService } from '../../../src/memory/embedding.js';

function makeMockLLM(overrides: Partial<{
  chatImpl: (input: LLMChatInput) => Promise<LLMChatOutput>;
  throwErr: Error;
}> = {}): LLMAdapter {
  const chatImpl =
    overrides.chatImpl ??
    (async () => ({
      content: 'mock reply',
      finishReason: 'stop' as const,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      model: 'mock-model',
    }));
  return {
    id: 'mock-llm',
    displayName: 'Mock',
    provider: 'custom' as any,
    model: 'mock-model',
    supportsToolCalls: true,
    supportsStreaming: false,
    contextWindow: 4096,
    chat: overrides.throwErr ? () => Promise.reject(overrides.throwErr) : chatImpl,
    async *streamChat() {
      yield { delta: '', done: true };
    },
    async embed() {
      return [];
    },
    async countTokens() {
      return 0;
    },
  };
}

describe('agents - AgentOrchestrator', () => {
  let mockLlm: LLMAdapter;

  beforeEach(() => {
    mockLlm = makeMockLLM();
  });

  it('初始状态应为 idle', () => {
    const orch = new AgentOrchestrator({ llm: mockLlm });
    expect(orch.getState()).toBe('idle');
    expect(orch.maxReActSteps).toBe(10);
    expect(orch.llmTimeout).toBeGreaterThan(0);
  });

  it('run 应驱动感知 + 思考阶段并返回结果', async () => {
    const orch = new AgentOrchestrator({ llm: mockLlm });
    const result = await orch.run({
      message: '你好',
      sessionId: 's1',
      channelId: 'webchat',
      userId: 'u1',
    });
    expect(result.reply).toBe('mock reply');
    expect(result.iterations).toBe(1);
    expect(result.terminatedReason).toBe('completed');
    expect(result.tokens.total).toBe(30);
    expect(result.stepEvents.length).toBeGreaterThan(0);
    expect(result.stepEvents.some((e) => e.phase === 'perceive')).toBe(true);
    expect(result.stepEvents.some((e) => e.phase === 'think')).toBe(true);
  });

  it('run 应在 LLM 抛出时进入 error 状态', async () => {
    const failingLlm = makeMockLLM({ throwErr: new Error('boom') });
    const orch = new AgentOrchestrator({ llm: failingLlm });
    const result = await orch.run({
      message: 'x',
      sessionId: 's',
      channelId: 'c',
      userId: 'u',
    });
    expect(orch.getState()).toBe('error');
    expect(result.terminatedReason).toBe('error');
    expect(result.reply).toContain('boom');
  });

  it('processMessage 应返回 agent 角色消息', async () => {
    const orch = new AgentOrchestrator({ llm: mockLlm });
    const reply = await orch.processMessage({
      id: 'm1',
      channelId: 'webchat',
      userId: 'u1',
      sessionId: 's1',
      type: 'text',
      role: 'user',
      content: 'hi',
      attachments: [],
      timestamp: Date.now(),
      metadata: {},
    } as any);
    expect(reply.role).toBe('agent');
    expect(reply.content).toBe('mock reply');
  });

  it('onStateChange 应在状态变化时通知监听器', async () => {
    const orch = new AgentOrchestrator({ llm: mockLlm });
    const states: string[] = [];
    const unsub = orch.onStateChange((s) => states.push(s));
    await orch.run({ message: 'x', sessionId: 's', channelId: 'c', userId: 'u' });
    unsub();
    expect(states.length).toBeGreaterThan(0);
    expect(states).toContain('thinking');
    expect(states).toContain('idle');
  });

  it('onStep 应实时接收阶段事件', async () => {
    const orch = new AgentOrchestrator({ llm: mockLlm });
    const events: string[] = [];
    const unsub = orch.onStep((e) => events.push(e.phase));
    await orch.run({ message: 'x', sessionId: 's', channelId: 'c', userId: 'u' });
    unsub();
    expect(events).toContain('perceive');
    expect(events).toContain('think');
    expect(events).toContain('plan');
  });

  it('abort 应中断正在执行的循环', async () => {
    let abortSignal: AbortSignal | undefined;
    const llmWithSignal: LLMAdapter = {
      ...makeMockLLM({
        chatImpl: async (input: LLMChatInput) => {
          abortSignal = input.signal;
          // 等待中止
          await new Promise((resolve, reject) => {
            if (!input.signal) return resolve(undefined);
            if (input.signal.aborted) return reject(new Error('aborted'));
            input.signal.addEventListener('abort', () => reject(new Error('aborted')));
          });
          // 实际不会执行到这里
          return {
            content: 'never',
            finishReason: 'stop' as const,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            model: 'x',
          };
        },
      }),
    };
    const orch = new AgentOrchestrator({ llm: llmWithSignal });
    const promise = orch.run({ message: 'x', sessionId: 's', channelId: 'c', userId: 'u' });
    // 异步触发 abort
    setTimeout(() => {
      void orch.abort();
    }, 10);
    await promise;
    expect(orch.getState()).toBe('idle');
    expect(abortSignal?.aborted).toBe(true);
  });

  it('reset 应清空状态', async () => {
    const orch = new AgentOrchestrator({ llm: mockLlm });
    await orch.run({ message: 'x', sessionId: 's', channelId: 'c', userId: 'u' });
    await orch.reset();
    expect(orch.getState()).toBe('idle');
  });

  it('isActionSafe 应委托给 Planner', () => {
    const orch = new AgentOrchestrator({ llm: mockLlm });
    expect(orch.isActionSafe('fs/read_file')).toBe(true);
    expect(orch.isActionSafe('exec/root')).toBe(false);
  });

  it('未传入 llm 时应使用默认 DeepSeek', () => {
    const orch = new AgentOrchestrator({});
    expect(orch.getState()).toBe('idle');
    // 不做真实网络调用，只确认构造不抛错
  });

  it('监听器取消订阅后不应再收到事件', async () => {
    const orch = new AgentOrchestrator({ llm: mockLlm });
    const listener = vi.fn();
    const unsub = orch.onStateChange(listener);
    unsub();
    await orch.run({ message: 'x', sessionId: 's', channelId: 'c', userId: 'u' });
    expect(listener).not.toHaveBeenCalled();
  });
  it('writes real session and vector memory entries for user and assistant messages', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'myoc-orchestrator-memory-'));

    try {
      const persist = new PersistLayer(dataDir);
      await persist.initialize();

      const sessionMemory = new SessionMemory(persist);
      const vectorMemory = new VectorMemory(new EmbeddingService({ provider: 'local' }), persist);

      const orch = new AgentOrchestrator({
        llm: mockLlm,
        sessionMemory,
        vectorMemory,
      });

      await orch.run({
        message: '请记住我是张三',
        sessionId: 'session-real-memory',
        channelId: 'web',
        userId: 'user-42',
      });

      const session = await sessionMemory.read('session-real-memory');
      expect(session).not.toBeNull();
      expect(session && !Array.isArray(session) ? session.userId : undefined).toBe('user-42');
      expect(session && !Array.isArray(session)
        ? session.messages.some((m) => m.role === 'user' && m.content === '请记住我是张三')
        : false).toBe(true);
      expect(session && !Array.isArray(session)
        ? session.messages.some((m) => m.role === 'assistant' && m.content === 'mock reply')
        : false).toBe(true);

      const recalls = await vectorMemory.search('张三', {
        sessionId: 'session-real-memory',
        topK: 5,
      });
      expect(recalls.some((entry) => entry.metadata.userId === 'user-42')).toBe(true);
      expect(recalls.some((entry) => entry.content.includes('请记住我是张三'))).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('normalizes existing auto-created session metadata when real context becomes available', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'myoc-orchestrator-session-normalize-'));

    try {
      const persist = new PersistLayer(dataDir);
      await persist.initialize();

      const sessionMemory = new SessionMemory(persist);
      await sessionMemory.append('session-upgrade', {
        id: 'seed-1',
        role: 'user',
        content: 'temporary content',
        timestamp: Date.now(),
      });

      const orch = new AgentOrchestrator({
        llm: mockLlm,
        sessionMemory,
      });

      await orch.run({
        message: '补全这个会话的真实上下文',
        sessionId: 'session-upgrade',
        channelId: 'webchat',
        userId: 'real-user',
      });

      const session = await sessionMemory.read('session-upgrade');
      expect(session?.userId).toBe('real-user');
      expect(session?.channelId).toBe('webchat');
      expect(session?.agentId).toBe('default');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // ── P1.3: runOptions (workMode / intensity / model) 透传到 LLM call ──

  it('P1.3: processMessage 从 message.metadata 提取 runOptions, buildSystemPrompt 注入 workMode 段', async () => {
    const captured: { systemContent: string; llmOptions: any } = {
      systemContent: '',
      llmOptions: undefined,
    };
    const capturingLlm: LLMAdapter = makeMockLLM({
      chatImpl: async (input: LLMChatInput): Promise<LLMChatOutput> => {
        const sysMsg = input.messages.find((m) => m.role === 'system');
        captured.systemContent = typeof sysMsg?.content === 'string' ? sysMsg.content : '';
        captured.llmOptions = input.options;
        return {
          content: 'mock',
          finishReason: 'stop' as const,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: 'x',
        };
      },
    });
    const orch = new AgentOrchestrator({ llm: capturingLlm });

    await orch.processMessage({
      id: 'm1',
      channelId: 'webchat',
      userId: 'u1',
      sessionId: 's1',
      type: 'text',
      role: 'user',
      content: 'P1.3 test',
      attachments: [],
      timestamp: Date.now(),
      metadata: { workMode: 'plan', intensity: 'low', model: 'deepseek-v4-flash' },
    } as any);

    // 1) system prompt 包含 Plan 模式段
    expect(captured.systemContent).toContain('Plan');
    expect(captured.systemContent).toContain('禁止调用任何工具');

    // 2) LLM options 含 model + intensity 映射
    expect(captured.llmOptions.model).toBe('deepseek-v4-flash');
    expect(captured.llmOptions.temperature).toBe(0.3);
    expect(captured.llmOptions.maxTokens).toBe(2048);
  });

  it('P1.3: 不传 runOptions 时, 走默认 (无 workMode 段, 默认 temperature=0.7)', async () => {
    const captured: { systemContent: string; llmOptions: any } = {
      systemContent: '',
      llmOptions: undefined,
    };
    const capturingLlm: LLMAdapter = makeMockLLM({
      chatImpl: async (input: LLMChatInput): Promise<LLMChatOutput> => {
        const sysMsg = input.messages.find((m) => m.role === 'system');
        captured.systemContent = typeof sysMsg?.content === 'string' ? sysMsg.content : '';
        captured.llmOptions = input.options;
        return {
          content: 'mock',
          finishReason: 'stop' as const,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: 'x',
        };
      },
    });
    const orch = new AgentOrchestrator({ llm: capturingLlm });

    await orch.processMessage({
      id: 'm1',
      channelId: 'webchat',
      userId: 'u1',
      sessionId: 's1',
      type: 'text',
      role: 'user',
      content: 'P1.3 test no opts',
      attachments: [],
      timestamp: Date.now(),
      metadata: {},
    } as any);

    // 1) system prompt 没有 Plan / Build 段
    expect(captured.systemContent).not.toContain('当前模式');

    // 2) LLM options 走默认: temperature 0.7, maxTokens 4096, 无 model 字段
    expect(captured.llmOptions.temperature).toBe(0.7);
    expect(captured.llmOptions.maxTokens).toBe(4096);
    expect(captured.llmOptions.model).toBeUndefined();
  });

  it('P1.3: build 模式 system prompt 允许工具调用, 不包含禁止字段', async () => {
    const captured: { systemContent: string } = { systemContent: '' };
    const capturingLlm: LLMAdapter = makeMockLLM({
      chatImpl: async (input: LLMChatInput): Promise<LLMChatOutput> => {
        const sysMsg = input.messages.find((m) => m.role === 'system');
        captured.systemContent = typeof sysMsg?.content === 'string' ? sysMsg.content : '';
        return {
          content: 'mock',
          finishReason: 'stop' as const,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          model: 'x',
        };
      },
    });
    const orch = new AgentOrchestrator({ llm: capturingLlm });
    await orch.processMessage({
      id: 'm1',
      channelId: 'webchat',
      userId: 'u1',
      sessionId: 's1',
      type: 'text',
      role: 'user',
      content: 'build mode',
      attachments: [],
      timestamp: Date.now(),
      metadata: { workMode: 'build' },
    } as any);

    expect(captured.systemContent).toContain('Build');
    expect(captured.systemContent).toContain('自由使用工具');
    expect(captured.systemContent).not.toContain('禁止');
  });
});
