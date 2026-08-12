/**
 * AgentOrchestrator 完整六阶段 Lobster 循环单元测试
 *
 * 覆盖完整的 感知→思考→规划→执行→观察→反思 循环，
 * 包括 Memory 集成、工具调用、Hook 管线、状态机转换等。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentOrchestrator } from '../../../src/agents/orchestrator.js';
import type { LLMAdapter, LLMChatInput, LLMChatOutput } from '../../../src/agents/llm/types.js';
import { MockToolRegistry, MockSessionMemory, MockVectorMemory, MockSkillRegistry } from '../../../src/agents/mock.js';
import { HookPipeline } from '../../../src/hooks/pipeline.js';
import { Planner } from '../../../src/agents/planner.js';

// ── 测试辅助函数 ──

/** 创建模拟 LLM 适配器 */
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

/** 创建带有 action 标签的 LLM 输出（触发工具调用） */
function makeLLMWithActions(actions: Array<{ tool: string; args: string }>) {
  const actionTags = actions
    .map((a) => `<action name="${a.tool}" args='${a.args}' />`)
    .join('\n');
  return `<thought>执行多步操作</thought>\n${actionTags}\n<final_answer>完成</final_answer>`;
}

describe('agents - AgentOrchestrator（完整六阶段循环）', () => {
  let mockLlm: LLMAdapter;

  beforeEach(() => {
    mockLlm = makeMockLLM();
  });

  // ═════════════════════════════════════════════════════════════
  // 原有兼容性测试
  // ═════════════════════════════════════════════════════════════

  it('初始状态应为 idle', () => {
    const orch = new AgentOrchestrator({ llm: mockLlm });
    expect(orch.getState()).toBe('idle');
    expect(orch.maxReActSteps).toBe(10);
    expect(orch.llmTimeout).toBeGreaterThan(0);
  });

  it('run 应驱动完整六阶段并返回结果', async () => {
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
    expect(result.completed).toBe(true);
    // 应包含关键阶段的记录（无工具调用时 observe/act/reflect 可能不触发）
    const phases = result.stepEvents.map((e) => e.phase);
    expect(phases).toContain('perceive');
    expect(phases).toContain('think');
    expect(phases).toContain('plan');
  });

  it('run 应在 LLM 抛出时进入 error 状态', async () => {
    const failingLlm = makeMockLLM({ throwErr: new Error('boom') });
    const orch = new AgentOrchestrator({ llm: failingLlm });
    const result = await orch.run({
      message: 'x', sessionId: 's', channelId: 'c', userId: 'u',
    });
    expect(orch.getState()).toBe('error');
    expect(result.terminatedReason).toBe('error');
    expect(result.reply).toContain('boom');
  });

  it('processMessage 应返回 agent 角色消息', async () => {
    const orch = new AgentOrchestrator({ llm: mockLlm });
    const reply = await orch.processMessage({
      id: 'm1', channelId: 'webchat', userId: 'u1', sessionId: 's1',
      type: 'text', role: 'user', content: 'hi',
      attachments: [], timestamp: Date.now(), metadata: {},
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
          await new Promise((_resolve, reject) => {
            if (!input.signal) return;
            if (input.signal.aborted) reject(new Error('aborted'));
            input.signal.addEventListener('abort', () => reject(new Error('aborted')));
          });
          return { content: 'never', finishReason: 'stop' as const, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: 'x' };
        },
      }),
    };
    const orch = new AgentOrchestrator({ llm: llmWithSignal });
    const promise = orch.run({ message: 'x', sessionId: 's', channelId: 'c', userId: 'u' });
    setTimeout(() => { void orch.abort(); }, 10);
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
  });

  it('监听器取消订阅后不应再收到事件', async () => {
    const orch = new AgentOrchestrator({ llm: mockLlm });
    const listener = vi.fn();
    const unsub = orch.onStateChange(listener);
    unsub();
    await orch.run({ message: 'x', sessionId: 's', channelId: 'c', userId: 'u' });
    expect(listener).not.toHaveBeenCalled();
  });

  // ═════════════════════════════════════════════════════════════
  // 新增：六阶段循环完整测试
  // ═════════════════════════════════════════════════════════════

  describe('六阶段循环完整流程', () => {
    it('应驱动完整的 Perceive→Think→Plan→Act→Observe→Reflect 循环（含工具调用）', async () => {
      // 创建模拟 LLM：第一次返回 action，第二次 Reflect 阶段返回 final_answer
      let callCount = 0;
      const multiCallLlm = makeMockLLM({
        chatImpl: async () => {
          callCount++;
          if (callCount === 1) {
            // Think 阶段：返回带 action 的输出
            return {
              content: makeLLMWithActions([
                { tool: 'fs/read_file', args: '{"path":"/workspace/test.txt"}' },
              ]),
              finishReason: 'stop' as const,
              usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
              model: 'mock',
            };
          }
          // Reflect 阶段：返回完成
          return {
            content: '<final_answer>文件已读取，内容为模拟数据。</final_answer>',
            finishReason: 'stop' as const,
            usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
            model: 'mock',
          };
        },
      });

      const sessionMemory = new MockSessionMemory();
      const vectorMemory = new MockVectorMemory();
      const toolRegistry = new MockToolRegistry();

      const orch = new AgentOrchestrator({
        llm: multiCallLlm,
        sessionMemory,
        vectorMemory,
        toolRegistry,
        maxIterations: 5,
      });

      const result = await orch.run({
        message: '请读取 workspace 下的 test.txt',
        sessionId: 'test-session',
        channelId: 'webchat',
        userId: 'u1',
      });

      // 验证结果
      expect(result.terminatedReason).toBe('completed');
      expect(result.completed).toBe(true);
      expect(result.reply).toBeTruthy();

      // 验证执行轨迹包含关键阶段
      const phases = result.stepEvents.map((e) => e.phase);
      expect(phases).toContain('perceive');
      expect(phases).toContain('think');
      expect(phases).toContain('plan');
      expect(phases).toContain('act');
      expect(phases).toContain('observe');
      expect(phases).toContain('reflect');

      // 验证 executionTrace 包含工具调用记录
      const actSteps = result.executionTrace.filter((s) => s.phase === 'act');
      expect(actSteps.length).toBeGreaterThan(0);
      expect(actSteps[0].tool).toBe('fs/read_file');
    });

    it('多步工具调用应按依赖关系顺序执行', async () => {
      let callCount = 0;
      const multiCallLlm = makeMockLLM({
        chatImpl: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              content: makeLLMWithActions([
                { tool: 'fs/read_file', args: '{"path":"/workspace/input.txt"}' },
                { tool: 'fs/write_file', args: '{"path":"/workspace/output.txt","content":"done"}' },
              ]),
              finishReason: 'stop' as const,
              usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
              model: 'mock',
            };
          }
          return {
            content: '<final_answer>任务完成，文件已处理。</final_answer>',
            finishReason: 'stop' as const,
            usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
            model: 'mock',
          };
        },
      });

      const toolRegistry = new MockToolRegistry();

      const orch = new AgentOrchestrator({
        llm: multiCallLlm,
        toolRegistry,
        maxIterations: 5,
      });

      const result = await orch.run({
        message: '处理文件',
        sessionId: 's', channelId: 'c', userId: 'u',
      });

      const actSteps = result.executionTrace.filter((s) => s.phase === 'act');
      expect(actSteps.length).toBeGreaterThanOrEqual(2);
      // 验证工具按顺序执行
      expect(actSteps[0].tool).toBe('fs/read_file');
      expect(actSteps[1].tool).toBe('fs/write_file');
    });

    it('应在达到最大迭代次数时终止', async () => {
      // 每次 LLM 都返回 action（永不完成，且不含 final_answer）
      const neverCompleteLlm = makeMockLLM({
        chatImpl: async () => ({
          content: '<thought>还需要继续</thought><action name="fs/read_file" args=\'{"path":"/test"}\' />',
          finishReason: 'stop' as const,
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          model: 'mock',
        }),
      });

      const orch = new AgentOrchestrator({
        llm: neverCompleteLlm,
        maxIterations: 2,
      });

      const result = await orch.run({
        message: 'loop forever',
        sessionId: 's', channelId: 'c', userId: 'u',
      });

      expect(result.terminatedReason).toBe('max_iterations');
      expect(result.completed).toBe(false);
    });

    it('状态机应在执行阶段变为 executing', async () => {
      const stateLog: string[] = [];
      let callCount = 0;
      const multiCallLlm = makeMockLLM({
        chatImpl: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              content: makeLLMWithActions([{ tool: 'fs/read_file', args: '{"path":"/test"}' }]),
              finishReason: 'stop' as const,
              usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
              model: 'mock',
            };
          }
          return {
            content: '<final_answer>done</final_answer>',
            finishReason: 'stop' as const,
            usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
            model: 'mock',
          };
        },
      });

      const orch = new AgentOrchestrator({ llm: multiCallLlm, maxIterations: 3 });
      orch.onStateChange((s) => stateLog.push(s));

      await orch.run({ message: 'test', sessionId: 's', channelId: 'c', userId: 'u' });

      expect(stateLog).toContain('thinking');
      expect(stateLog).toContain('executing');
      expect(stateLog).toContain('idle');
    });
  });

  // ═════════════════════════════════════════════════════════════
  // Memory 集成测试
  // ═════════════════════════════════════════════════════════════

  describe('Memory 集成', () => {
    it('应加载会话历史作为上下文', async () => {
      const sessionMemory = new MockSessionMemory();
      await sessionMemory.append('test-s', {
        role: 'user', content: '之前的消息', timestamp: Date.now() - 1000,
      });
      await sessionMemory.append('test-s', {
        role: 'assistant', content: '之前的回复', timestamp: Date.now() - 500,
      });

      const orch = new AgentOrchestrator({
        llm: mockLlm,
        sessionMemory,
      });

      const result = await orch.run({
        message: '新消息',
        sessionId: 'test-s',
        channelId: 'webchat',
        userId: 'u1',
      });

      expect(result.terminatedReason).toBe('completed');
    });

    it('应检索向量长期记忆', async () => {
      const vectorMemory = new MockVectorMemory();
      const orch = new AgentOrchestrator({
        llm: mockLlm,
        vectorMemory,
      });

      const result = await orch.run({
        message: '搜索相关记忆',
        sessionId: 's', channelId: 'c', userId: 'u',
      });

      expect(result.terminatedReason).toBe('completed');
    });
  });

  // ═════════════════════════════════════════════════════════════
  // Hook 管线集成测试
  // ═════════════════════════════════════════════════════════════

  describe('Hook 管线集成', () => {
    it('应在各阶段触发对应的 Hook', async () => {
      const hooks = new HookPipeline();
      const hookEvents: string[] = [];

      hooks.register({
        name: 'test-hook',
        event: 'message.pre',
        handler: () => { hookEvents.push('message.pre'); },
      });
      hooks.register({
        name: 'llm-pre',
        event: 'llm.pre',
        handler: () => { hookEvents.push('llm.pre'); },
      });
      hooks.register({
        name: 'llm-post',
        event: 'llm.post',
        handler: () => { hookEvents.push('llm.post'); },
      });

      const orch = new AgentOrchestrator({
        llm: mockLlm,
        hookPipeline: hooks,
      });

      await orch.run({ message: 'hello', sessionId: 's', channelId: 'c', userId: 'u' });

      expect(hookEvents).toContain('message.pre');
      expect(hookEvents).toContain('llm.pre');
      expect(hookEvents).toContain('llm.post');
    });

    it('应在工具调用时触发 tool.pre 和 tool.post Hook', async () => {
      const hooks = new HookPipeline();
      const hookEvents: string[] = [];

      hooks.register({
        name: 'tool-pre',
        event: 'tool.pre',
        handler: () => { hookEvents.push('tool.pre'); },
      });
      hooks.register({
        name: 'tool-post',
        event: 'tool.post',
        handler: () => { hookEvents.push('tool.post'); },
      });

      let callCount = 0;
      const multiCallLlm = makeMockLLM({
        chatImpl: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              content: makeLLMWithActions([{ tool: 'fs/read_file', args: '{"path":"/test"}' }]),
              finishReason: 'stop' as const,
              usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
              model: 'mock',
            };
          }
          return {
            content: '<final_answer>done</final_answer>',
            finishReason: 'stop' as const,
            usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
            model: 'mock',
          };
        },
      });

      const orch = new AgentOrchestrator({
        llm: multiCallLlm,
        hookPipeline: hooks,
        maxIterations: 3,
      });

      await orch.run({ message: 'read', sessionId: 's', channelId: 'c', userId: 'u' });

      expect(hookEvents).toContain('tool.pre');
      expect(hookEvents).toContain('tool.post');
    });

    it('Hook 执行失败不应中断主流程', async () => {
      const hooks = new HookPipeline();
      hooks.register({
        name: 'failing-hook',
        event: 'message.pre',
        handler: () => { throw new Error('hook error'); },
      });

      const orch = new AgentOrchestrator({
        llm: mockLlm,
        hookPipeline: hooks,
      });

      const result = await orch.run({ message: 'test', sessionId: 's', channelId: 'c', userId: 'u' });
      expect(result.terminatedReason).toBe('completed');
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 系统提示词构建测试
  // ═════════════════════════════════════════════════════════════

  describe('系统提示词构建', () => {
    it('应包含技能和工具描述', async () => {
      const skillRegistry = new MockSkillRegistry();
      const toolRegistry = new MockToolRegistry();

      const orch = new AgentOrchestrator({
        llm: mockLlm,
        skillRegistry,
        toolRegistry,
      });

      const result = await orch.run({
        message: '测试',
        sessionId: 's', channelId: 'c', userId: 'u',
      });

      expect(result.reply).toBeTruthy();
    });

    it('应支持自定义 agentName 和 agentRole', async () => {
      const orch = new AgentOrchestrator({
        llm: mockLlm,
        agentName: '自定义助手',
        agentRole: '代码审查专家',
      });

      const result = await orch.run({
        message: 'test', sessionId: 's', channelId: 'c', userId: 'u',
      });

      expect(result.reply).toBeTruthy();
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 执行轨迹测试
  // ═════════════════════════════════════════════════════════════

  describe('执行轨迹 (executionTrace)', () => {
    it('应记录完整的执行步骤轨迹', async () => {
      const orch = new AgentOrchestrator({ llm: mockLlm });

      const result = await orch.run({
        message: 'trace test',
        sessionId: 's', channelId: 'c', userId: 'u',
      });

      expect(result.executionTrace).toBeDefined();
      expect(result.executionTrace.length).toBeGreaterThan(0);

      // 验证步骤有正确的序号和阶段
      const trace = result.executionTrace;
      for (const step of trace) {
        expect(step.index).toBeGreaterThan(0);
        expect(step.status).toMatch(/^(success|failed|skipped)$/);
        expect(step.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('工具执行失败时应记录失败状态', async () => {
      const toolRegistry = new MockToolRegistry();
      // 注册一个会失败的工具行为
      toolRegistry.register({
        name: 'exec/shell',
        description: '执行命令',
        category: 'exec',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      });
      toolRegistry.registerBehavior('exec/shell', async () => {
        throw new Error('模拟工具执行失败');
      });

      let callCount = 0;
      const multiCallLlm = makeMockLLM({
        chatImpl: async () => {
          callCount++;
          if (callCount === 1) {
            return {
              content: makeLLMWithActions([{ tool: 'exec/shell', args: '{"command":"ls"}' }]),
              finishReason: 'stop' as const,
              usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
              model: 'mock',
            };
          }
          return {
            content: '<final_answer>任务已完成（尽管部分工具失败）</final_answer>',
            finishReason: 'stop' as const,
            usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
            model: 'mock',
          };
        },
      });

      const orch = new AgentOrchestrator({
        llm: multiCallLlm,
        toolRegistry,
        maxIterations: 3,
      });

      const result = await orch.run({
        message: 'run shell',
        sessionId: 's', channelId: 'c', userId: 'u',
      });

      const failedSteps = result.executionTrace.filter((s) => s.status === 'failed');
      expect(failedSteps.length).toBeGreaterThan(0);
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 自定义 Planner 测试
  // ═════════════════════════════════════════════════════════════

  describe('自定义 Planner', () => {
    it('应支持传入自定义 Planner 实例', async () => {
      const customPlanner = new Planner({ allowedPaths: ['/custom'] });
      const orch = new AgentOrchestrator({
        llm: mockLlm,
        planner: customPlanner,
      });

      const result = await orch.run({
        message: 'test', sessionId: 's', channelId: 'c', userId: 'u',
      });

      expect(result.reply).toBeTruthy();
    });

    it('应通过 plannerContext 配置路径白名单', async () => {
      const orch = new AgentOrchestrator({
        llm: mockLlm,
        plannerContext: { allowedPaths: ['/restricted'] },
      });

      const result = await orch.run({
        message: 'test', sessionId: 's', channelId: 'c', userId: 'u',
      });

      expect(result.reply).toBeTruthy();
    });
  });
});
