/**
 * AgentOrchestrator — Lobster 主循环调度器（完整实现版）
 *
 * 文档参考：docs/05-Agent运行时模块.md §2.1、§4.2、§5
 *
 * 驱动完整的 感知→思考→规划→执行→观察→反思 六阶段循环，
 * 维护 Agent 状态机，协调 Planner、LLM Adapter、ToolRegistry、Memory、Hook 协同工作。
 *
 * 实现状态：
 * - 完整六阶段 Lobster 循环 ✓
 * - Agent 状态机（idle→thinking→executing→error） ✓
 * - Memory 集成（Session + Vector） ✓
 * - Skills/Tools 集成（通过 Mock 组件占位） ✓
 * - Hook Pipeline 集成 ✓
 * - 最大迭代保护 ✓
 * - 中止与重置 ✓
 * - 状态与步骤事件监听 ✓
 *
 * @module @myopenclaw/server/agents
 */

import { createLogger } from '../core/utils/logger.js';
import { generateId } from '../core/utils/id.js';
import { LLM_TIMEOUT_MS } from '../core/constants/index.js';
import { LLMAdapterFactory } from './llm/factory.js';
import type { LLMAdapter, LLMChatInput, LLMChatOutput, LLMMessage } from './llm/types.js';
import type { AgentState, Message } from '../core/types/index.js';
import { Planner } from './planner.js';
import type {
  PlannerSubTask,
  ExecutionPlan,
  PlannerContext,
  UserPermissions,
  ToolDescriptor,
} from './planner.js';
import type { InvokeContext } from '../core/types/tool.js';
import { ReActLoop } from './loop/index.js';
import {
  extractRunOptions,
  intensityToLLMOptions,
  workModeSystemPromptAddon,
  type AgentRunOptions,
} from './run-options.js';
import type { LoopPhase, LoopStepEvent } from './loop/index.js';
import { MockToolRegistry, MockSkillRegistry, MockVectorMemory, MockSessionMemory } from './mock.js';
import { ToolRegistry } from '../tools/registry.js';
import { SkillRegistry } from '../skills/registry.js';
import { SessionMemory, VectorMemory } from '../memory/index.js';
import type { HookPipeline } from '../hooks/pipeline.js';
import type { HookEvent } from '../hooks/types.js';

const log = createLogger('agent:orchestrator');

// ═══════════════════════════════════════════════════════════════
// 常量定义
// ═══════════════════════════════════════════════════════════════

const DEFAULT_MAX_REACT_STEPS = 10;
const DEFAULT_MAX_ITERATIONS = 10;

// ═══════════════════════════════════════════════════════════════
// 类型定义（对齐文档 §4.2）
// ═══════════════════════════════════════════════════════════════

/** Orchestrator 配置选项 */
export interface OrchestratorOptions {
  /** LLM 适配器（不传则使用默认 DeepSeek） */
  llm?: LLMAdapter;
  /** Planner 实例 */
  planner?: Planner;
  /** Loop 计数器实例 */
  loop?: ReActLoop;
  /** 单步最大 ReAct 步骤数（步骤级） */
  maxReActSteps?: number;
  /** Lobster 循环最大迭代轮数 */
  maxIterations?: number;
  /** LLM 调用超时（毫秒） */
  llmTimeoutMs?: number;
  /** Agent 身份名称 */
  agentName?: string;
  /** Agent 角色描述 */
  agentRole?: string;
  /** 会话记忆（短期），支持真实 SessionMemory 或 Mock */
  sessionMemory?: SessionMemory | MockSessionMemory;
  /** 向量记忆（长期），支持真实 VectorMemory 或 Mock */
  vectorMemory?: VectorMemory | MockVectorMemory;
  /** 工具注册中心（支持 Mock 或真实实现） */
  toolRegistry?: MockToolRegistry | ToolRegistry;
  /** 技能注册中心（支持 Mock 或真实实现） */
  skillRegistry?: MockSkillRegistry | SkillRegistry;
  /** Hook 管线 */
  hookPipeline?: HookPipeline;
  /** 规划上下文配置 */
  plannerContext?: Partial<PlannerContext>;
  /** 单轮循环总超时（毫秒） */
  loopTimeoutMs?: number;
}

/** Agent 运行输入（对齐文档 §4.2 AgentRunInput） */
export interface AgentRunInput {
  /** 用户消息内容 */
  message: string;
  /** 会话 ID */
  sessionId: string;
  /** 渠道 ID */
  channelId: string;
  /** 用户 ID */
  userId: string;
  /** 历史消息（用于上下文） */
  history?: LLMMessage[];
  /** 工具描述符（Planner 视角） */
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  /**
   * 运行期选项（workMode / intensity / model）
   * 来自 client 端 chat.send payload, 跟 Message.metadata 同源
   */
  runOptions?: AgentRunOptions;
  /**
   * 客户端主动激活的技能名列表（Web 端技能面板选择的技能）
   * Orchestrator 优先按此列表注入完整技能说明，不再依赖 triggers 关键词猜测
   */
  activatedSkills?: string[];
  /**
   * 客户端主动激活的工具名列表（Web 端技能面板选择的工具）
   * Orchestrator 会在系统提示词中突出这些工具，优先供 LLM 调用
   */
  activatedTools?: string[];
  /**
   * 工作模式命令（Spec/Plan 等快捷命令的 id），用于注入对应的强约束指令
   * 例如 'spec' → 先出规范文档再执行；'plan' → 先出计划再执行
   */
  workModeCommand?: 'spec' | 'plan';
}

/** Agent 运行结果（对齐文档 §4.2 AgentRunResult） */
export interface AgentRunResult {
  /** 最终回复给用户的文本内容 */
  reply: string;
  /** 循环轮次 */
  iterations: number;
  /** Token 使用统计 */
  tokens: { prompt: number; completion: number; total: number };
  /** 终止原因 */
  terminatedReason: 'completed' | 'aborted' | 'max_iterations' | 'error';
  /** 执行耗时（毫秒） */
  durationMs: number;
  /**
   * 思考过程(reasoning_content)汇总
   * - 聚合所有 Think 阶段 LLM 返回的 reasoningContent(多轮 ReAct 每轮都可能推理)
   * - 轮与轮之间用 "\n\n---\n\n" 分隔
   * - 若模型(V3 / 多数非推理模型)不返回 reasoning_content,此字段为空字符串
   * - 供上层 Gateway → TUI 推 chat.reasoning_delta + chat.done.totalReasoning
   */
  reasoning?: string;
  /**
   * 思考过程累计耗时(毫秒)
   * - 从第一次 Think 调用开始,到最后一次 Think 调用的时长
   * - 若完全没有 reasoning(模型不返回),此字段为 undefined
   */
  reasoningDurationMs?: number;
  /** 阶段事件列表 */
  stepEvents: LoopStepEvent[];
  /** 执行步骤轨迹 */
  executionTrace: ExecutionStep[];
  /** 循环是否正常完成 */
  completed: boolean;
}

/** 单个执行步骤记录（对齐文档 §4.2 ExecutionStep） */
export interface ExecutionStep {
  /** 步骤序号 */
  index: number;
  /** 所属循环阶段 */
  phase: LoopPhase;
  /** 调用的工具名 */
  tool?: string;
  /** 工具入参 */
  params?: Record<string, unknown>;
  /** 工具出参或 LLM 输出 */
  output?: unknown;
  /** 本步骤耗时（毫秒） */
  durationMs: number;
  /** 本步骤状态 */
  status: 'success' | 'failed' | 'skipped';
}

// ═══════════════════════════════════════════════════════════════
// 监听器类型
// ═══════════════════════════════════════════════════════════════

/** 状态变更监听器 */
type StateListener = (state: AgentState) => void;
/** 步骤事件监听器 */
type StepListener = (event: LoopStepEvent) => void;

// ═══════════════════════════════════════════════════════════════
// AgentOrchestrator 核心类
// ═══════════════════════════════════════════════════════════════

export class AgentOrchestrator {
  /** 当前 Agent 状态机状态 */
  state: AgentState = 'idle';

  // ── 核心组件 ──
  private llm: LLMAdapter;
  private planner: Planner;
  private loop: ReActLoop;

  // ── 配置参数 ──
  private maxSteps: number;
  private maxIterations: number;
  private llmTimeoutMs: number;
  private agentName: string;
  private agentRole: string;

  // ── 集成组件（可选） ──
  private sessionMemory: SessionMemory | MockSessionMemory;
  private vectorMemory: VectorMemory | MockVectorMemory;
  private toolRegistry: MockToolRegistry | ToolRegistry;
  private skillRegistry: MockSkillRegistry | SkillRegistry;
  private hookPipeline?: HookPipeline;

  // ── 运行时状态 ──
  private stateListeners = new Set<StateListener>();
  private stepListeners = new Set<StepListener>();
  private abortController: AbortController | null = null;
  private executionStepIndex = 0;
  private accumulatedTokens = { prompt: 0, completion: 0, total: 0 };
  private executionTraceInternal: ExecutionStep[] = [];

  // ── 规划上下文配置 ──
  private plannerContextConfig: Partial<PlannerContext>;

  constructor(options: OrchestratorOptions = {}) {
    // 初始化 LLM 适配器
    this.llm = options.llm ?? LLMAdapterFactory.create({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      timeoutMs: options.llmTimeoutMs ?? LLM_TIMEOUT_MS,
    });

    // 初始化规划器
    this.planner = options.planner ?? new Planner({
      allowedPaths: options.plannerContext?.allowedPaths,
    });

    // 初始化循环计数器
    this.loop = options.loop ?? new ReActLoop();

    // 配置参数
    this.maxSteps = options.maxReActSteps ?? DEFAULT_MAX_REACT_STEPS;
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.llmTimeoutMs = options.llmTimeoutMs ?? LLM_TIMEOUT_MS;
    this.agentName = options.agentName ?? 'MyOpenClaw Assistant';
    this.agentRole = options.agentRole ?? '通用任务处理智能助手';

    // 集成组件（使用 Mock 作为默认值）
    this.sessionMemory = options.sessionMemory ?? new MockSessionMemory();
    this.vectorMemory = options.vectorMemory ?? new MockVectorMemory();
    this.toolRegistry = options.toolRegistry ?? new MockToolRegistry();
    this.skillRegistry = options.skillRegistry ?? new MockSkillRegistry();
    this.hookPipeline = options.hookPipeline;

    // 规划上下文配置
    this.plannerContextConfig = options.plannerContext ?? {};
  }

  // ═════════════════════════════════════════════════════════════
  // 公共属性（兼容旧接口）
  // ═════════════════════════════════════════════════════════════

  /** 当前状态 */
  getState(): AgentState {
    return this.state;
  }

  /** 最大步骤数 */
  get maxReActSteps(): number {
    return this.maxSteps;
  }

  /** LLM 超时 */
  get llmTimeout(): number {
    return this.llmTimeoutMs;
  }

  // ═════════════════════════════════════════════════════════════
  // 主入口方法
  // ═════════════════════════════════════════════════════════════

  /**
   * 处理用户消息（兼容网关调用）
   *
   * @param message 标准化消息对象
   * @returns Agent 回复消息
   */
  async processMessage(message: Message): Promise<Message> {
    const runOptions = extractRunOptions(message.metadata);
    // ── 关键修复：从 Gateway 注入的 metadata.gatewayHistory 取真实会话历史 ──
    // 确保 LLM 感知阶段的上下文与用户前端显示的完全一致，而非读另一套独立存储的脏数据
    const gatewayHistory = (message.metadata?.gatewayHistory as { role: 'user' | 'assistant'; content: string }[] | undefined) ?? [];
    // ── 提取客户端主动激活的技能/工具/工作模式命令 ──
    // 这些字段来自 Web 端技能面板选择，由 chat.send payload 透传到 Message.metadata
    const activatedSkills = Array.isArray(message.metadata?.activatedSkills)
      ? (message.metadata.activatedSkills as string[])
      : undefined;
    const activatedTools = Array.isArray(message.metadata?.activatedTools)
      ? (message.metadata.activatedTools as string[])
      : undefined;
    const workModeCommandRaw = message.metadata?.workModeCommand;
    const workModeCommand =
      workModeCommandRaw === 'spec' || workModeCommandRaw === 'plan'
        ? workModeCommandRaw
        : undefined;

    const result = await this.run({
      message: message.content,
      sessionId: message.sessionId,
      channelId: message.channelId,
      userId: message.userId,
      runOptions,
      // 将 Gateway 层持久化的真实历史注入给 run()
      history: gatewayHistory.length > 0 ? gatewayHistory : undefined,
      // 客户端主动激活的技能/工具/工作模式
      activatedSkills,
      activatedTools,
      workModeCommand,
    });
    return {
      ...message,
      role: 'agent',
      content: result.reply,
      // reasoning_content 透传:塞到 metadata 里,
      // — Message 类型本身无此字段,走 metadata 通用扩展
      // — AgentBridge.invoke 会从 metadata 读出并写入 AgentInvokeResult
      // — websocket-handler 拿到后推 chat.reasoning_delta
      metadata: {
        ...message.metadata,
        reasoningContent: result.reasoning ?? '',
        reasoningDurationMs: result.reasoningDurationMs,
      },
    };
  }

  /**
   * 完整 Lobster 六阶段循环入口（文档 §5）
   *
   * 驱动 感知→思考→规划→执行→观察→反思 循环，
   * 直到任务完成或达到最大迭代次数。
   *
   * @param input 用户输入及会话上下文
   * @returns Agent 处理结果
   */
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const startedAt = Date.now();
    this.loop.reset();
    this.abortController = new AbortController();
    this.executionStepIndex = 0;
    this.executionTraceInternal = [];
    this.accumulatedTokens = { prompt: 0, completion: 0, total: 0 };

    await this.ensureSessionContext(input);

    // ── 状态：Idle → Thinking ──
    this.setState('thinking');
    this.loop.nextIteration();

    const stepEvents: LoopStepEvent[] = [];
    const recordPhaseEvent = (phase: LoopPhase, detail: string) => {
      const evt = this.loop.recordStep(phase, detail);
      stepEvents.push(evt);
      this.stepListeners.forEach((l) => l(evt));
    };

    let reply = '';
    let terminatedReason: AgentRunResult['terminatedReason'] = 'completed';
    // ── reasoning 聚合 ──
    // 每次 Think 阶段 LLM 都会返回 reasoning_content(若模型支持,如 R1)
    // 多轮 ReAct 循环中,Reflect 阶段也会再 Think 一次,需要把这些 reasoning 都聚合
    // 轮间用 "\n\n---\n\n" 分隔,保持可读
    let aggregatedReasoning = '';
    let reasoningStartedAt: number | null = null;
    let reasoningEndedAt: number | null = null;

    await this.persistConversationMessage(input.sessionId, {
      id: generateId(),
      role: 'user',
      content: input.message,
      timestamp: startedAt,
    }, {
      storeVector: true,
      type: 'conversation',
      importance: 0.7,
      tags: ['user', 'input'],
      userId: input.userId,
    });

    // ── 构建规划上下文 ──
    const plannerContext = this.buildPlannerContext(input);

    // ── 当前消息列表（贯穿多轮迭代） ──
    let currentMessages: LLMMessage[] = [
      {
        role: 'system',
        content: this.buildSystemPrompt(input),
      },
      ...(input.history ?? []),
      { role: 'user', content: input.message },
    ];

    try {
      // ═════════════════════════════════════════════════════════
      // Lobster 主循环
      // ═════════════════════════════════════════════════════════
      let iterationCount = 0;
      let taskComplete = false;
      // 死循环检测:记录最近几轮的 action 指纹,若连续重复则强制终止
      const recentActionSignatures: string[] = [];
      const MAX_REPEAT = 2;
      // 保存上一轮的工具执行结果,用于死循环时判断工具是否已成功执行
      let lastActResults: Array<{ result: unknown; success: boolean }> | null = null;
      // ── 新增: 记录最近几轮 LLM 原始输出(检测"解析失败但重复输出"的死循环 ──
      // 用于 tasks=0 但LLM又输出相同文本的情况
      const recentLlmTexts: string[] = [];
      const MAX_LLM_TEXT_REPEAT = 2;

      while (!taskComplete && iterationCount < this.maxIterations) {
        iterationCount++;

        // ── 阶段 1：感知（Perceive）── 加载上下文 ──
        await this.phasePerceive(input, recordPhaseEvent, currentMessages);

        // ── 阶段 2：思考（Think）── 调用 LLM 推理 ──
        const { output: thinkResult, thinkStartedAt, thinkEndedAt } = await this.phaseThink(
          currentMessages,
          plannerContext,
          recordPhaseEvent,
          input.runOptions,
        );

        // 累加 Token
        this.accumulatedTokens.prompt += thinkResult.usage.promptTokens;
        this.accumulatedTokens.completion += thinkResult.usage.completionTokens;
        this.accumulatedTokens.total += thinkResult.usage.totalTokens;

        // 聚合 reasoning_content(若模型支持,如 DeepSeek R1 / o1)
        // 第一次 Think:记 reasoningStartedAt = LLM 调用开始时间(从 phaseThink 传出)
        //             reasoningEndedAt = LLM 调用结束时间
        // — 用 LLM 调用耗时作为思考耗时(LLM 调用就是思考阶段)
        // — 多次 ReAct 轮次时,只取首轮的 start / 末轮的 end
        if (thinkResult.reasoningContent && thinkResult.reasoningContent.length > 0) {
          if (reasoningStartedAt === null) {
            reasoningStartedAt = thinkStartedAt;
          }
          reasoningEndedAt = thinkEndedAt;
          if (aggregatedReasoning.length > 0) {
            aggregatedReasoning += '\n\n---\n\n';
          }
          aggregatedReasoning += thinkResult.reasoningContent;
        }

        const llmOutput = thinkResult.content;

        // 将 assistant 回复加入消息历史
        currentMessages.push({
          role: 'assistant',
          content: llmOutput,
          toolCalls: thinkResult.toolCalls,
        });

        // ── 阶段 3：规划（Plan）── 拆解子任务 + 安全校验 ──
        const tasks = await this.phasePlan(llmOutput, plannerContext, recordPhaseEvent);

        // 死循环检测:若本轮的 action 序列和上一轮完全一致,说明 LLM 一直想调同一个工具,
        // 极可能是该工具不存在/一直失败,LLM 卡死。强制收尾。
        // 但如果上一轮工具实际执行成功(LLM 只是没看到结果又调了一次),则用工具结果作为最终回复。
        const sig = tasks.map((t) => `${t.tool}:${JSON.stringify(t.params)}`).sort().join('|');
        if (sig.length > 0) {
          recentActionSignatures.push(sig);
          if (recentActionSignatures.length >= 2 &&
              recentActionSignatures[recentActionSignatures.length - 1] === recentActionSignatures[recentActionSignatures.length - 2]) {
            // 连续两轮 action 完全一样,说明 LLM 死循环
            const lastSameCount = recentActionSignatures.slice(-MAX_REPEAT - 1)
              .filter((s) => s === sig).length;
            if (lastSameCount >= MAX_REPEAT) {
              log.warn({ iteration: iterationCount, sig }, '检测到 LLM 死循环(连续多轮相同 action),强制收尾');
              recordPhaseEvent('reflect', `检测到死循环(${lastSameCount} 轮相同 action),强制收尾`);

              // 检查上一轮工具执行结果:如果工具成功执行过,直接用工具结果作为最终回复
              // 这样能处理 "LLM 调用了 system/time 但 Reflect 阶段又调了一次" 的情况
              const lastToolResults = lastActResults ?? [];
              const allSucceeded = lastToolResults.length > 0 &&
                lastToolResults.every((r) => r?.success !== false);

              const loopParsed = this.planner.parseCoT(llmOutput);

              if (allSucceeded && lastToolResults.length > 0) {
                // 工具执行成功,但 LLM 重复调用 → 用工具结果生成最终回复
                const toolData = lastToolResults.map((r) => {
                  const payload = typeof r?.result === 'string' ? r.result : JSON.stringify(r?.result ?? '');
                  return payload;
                }).join('\n');
                reply = loopParsed.finalAnswer ??
                  `根据查询结果:\n${toolData}` +
                  (loopParsed.thought ? `\n\n${loopParsed.thought}` : '');
                log.info({ iteration: iterationCount, toolDataLen: toolData.length }, '死循环但工具成功,用工具结果作为最终回复');
              } else {
                // 工具执行失败或无结果 → 报错给用户
                reply = loopParsed.finalAnswer ??
                  `抱歉,我尝试多次但无法完成该任务(连续 ${lastSameCount} 轮相同操作)。` +
                  (loopParsed.thought ? `\n\n当前分析: ${loopParsed.thought}` : '');
              }
              taskComplete = true;
              // P1.3 fix: 死循环强制收尾属于"未正常完成",应标记为 max_iterations 而非 completed
              terminatedReason = 'max_iterations';
              break;
            }
          }
        }

        // ── 新增修复: LLM 输出文本重复检测(即使 tasks 为空也触发) ──
        // 用于捕获: 1) 解析失败的 action (文本含 <action 但 tasks=0)
        //          2) LLM 重复输出相同思考文本但没输出 final_answer
        const llmTextSig = llmOutput.slice(0, 300).replace(/\s+/g, ' ');
        recentLlmTexts.push(llmTextSig);
        if (recentLlmTexts.length >= MAX_LLM_TEXT_REPEAT) {
          const lastN = recentLlmTexts.slice(-MAX_LLM_TEXT_REPEAT);
          const allSameText = lastN.every((t) => t === lastN[0] && t.length > 0);
          const containsActionButNoTasks = /<action\b/i.test(llmOutput) && tasks.length === 0;
          if (allSameText || containsActionButNoTasks) {
            log.warn(
              { iteration: iterationCount, sigLen: llmTextSig.length, allSameText, containsActionButNoTasks },
              '检测到 LLM 文本重复/解析失败,进行强制收尾',
            );
            recordPhaseEvent(
              'reflect',
              allSameText ? '检测到多轮文本重复输出,强制收尾' : 'action 标签解析失败,跳过工具调用并收尾',
            );
            // 优先用已有的工具结果(如果上一轮有成功的)
            const lastToolResults = lastActResults ?? [];
            const allSucceeded = lastToolResults.length > 0 &&
              lastToolResults.every((r) => r?.success !== false);
            const loopParsed = this.planner.parseCoT(llmOutput);
            if (allSucceeded && lastToolResults.length > 0) {
              const toolData = lastToolResults.map((r) => {
                const payload = typeof r?.result === 'string' ? r.result : JSON.stringify(r?.result ?? '');
                return payload;
              }).join('\n');
              reply = loopParsed.finalAnswer ?? `根据查询结果:\n${toolData}`;
            } else {
              reply = loopParsed.finalAnswer ?? llmOutput
                .replace(/<action[\s\S]*?<\/action>/g, '') // 去除解析失败的 action 标签
                .replace(/<action[^>]*?\/>/g, '');
            }
            taskComplete = true;
            // P1.3 fix: 文本重复强制收尾同样属于"未正常完成"
            terminatedReason = 'max_iterations';
            break;
          }
        }

        if (tasks.length === 0) {
          // LLM 直接回复（无工具调用需求）
          // 从 XML 输出中提取 <final_answer>,避免把 <thought> 也送给用户
          recordPhaseEvent('reflect', '无子任务生成，LLM 已直接回复，任务完成');
          const planParsed = this.planner.parseCoT(llmOutput);
          reply = planParsed.finalAnswer ?? llmOutput;
          taskComplete = true;
          break;
        }

        // ── 阶段 4：执行（Act）── 按计划调用工具 ──
        // 状态：Thinking → Executing
        this.setState('executing');
        const executionPlan = this.planner.schedule(tasks);
        const actResults = await this.phaseAct(
          executionPlan,
          input,
          recordPhaseEvent,
        );

        // 保存本轮工具执行结果,供下一轮死循环检测使用
        lastActResults = actResults;

        // 将工具结果加入消息历史
        // 关键:由于我们不传 tools 给 LLM(走 XML action tag 而非 function_calling),
        // 这里 **不能** 塞 { role: 'tool' } 消息 —— 因为对应的 assistant 消息没有
        // tool_calls 字段,DeepSeek API 校验会 400 拒绝(messages[N]: missing field 'tool_call_id')。
        //
        // 正确做法:把工具结果包装成**用户消息**(人类语言),让 LLM 在 Reflect 阶段
        // 能看到"工具已经调用过了,结果是这样"即可。LLM 会据此判断继续 action 还是 final_answer。
        const toolResultBlock = (actResults ?? []).map((r, i) => {
          const task = tasks[i];
          const ok = r?.success !== false;
          const payload = typeof r?.result === 'string' ? r.result : JSON.stringify(r?.result ?? '');
          return `【工具执行结果】#${i + 1} ${task?.tool ?? '?'} ${ok ? '成功' : '失败'}\n${payload}`;
        }).join('\n\n');
        if (toolResultBlock.length > 0) {
          currentMessages.push({
            role: 'user',
            content: toolResultBlock,
          });
        }

        // ── 阶段 5：观察（Observe）── 结果回填上下文 ──
        await this.phaseObserve(actResults, input, recordPhaseEvent);

        // ── 阶段 6：反思（Reflect）── LLM 判断是否完成 ──
        // 状态：Executing → Thinking
        this.setState('thinking');
        const reflectResult = await this.phaseReflect(
          currentMessages,
          plannerContext,
          recordPhaseEvent,
          input.runOptions,
        );

        if (reflectResult.complete) {
          // Reflect 阶段 LLM 输出也可能带 <final_answer>,需要提取
          const reflectParsed = this.planner.parseCoT(reflectResult.content);
          reply = reflectParsed.finalAnswer ?? reflectResult.content;
          taskComplete = true;
          break;
        }

        // 最大迭代保护
        if (this.loop.isIterationExceeded(this.maxIterations)) {
          terminatedReason = 'max_iterations';
          const source = reflectResult.content || llmOutput;
          const maxParsed = this.planner.parseCoT(source);
          reply = maxParsed.finalAnswer ?? source;
          break;
        }

        // 若未完成，将 Reflect 阶段的 assistant 回复加入消息历史
        currentMessages.push({
          role: 'assistant',
          content: reflectResult.content,
        });

        // 最大迭代保护
        if (this.loop.isIterationExceeded(this.maxIterations)) {
          terminatedReason = 'max_iterations';
          const source = reflectResult.content || llmOutput;
          const maxParsed = this.planner.parseCoT(source);
          reply = maxParsed.finalAnswer ?? source;
          break;
        }

        this.loop.nextIteration();
      }

      // 循环结束
      if (!taskComplete && terminatedReason !== 'max_iterations') {
        terminatedReason = 'max_iterations';
      }

      if (reply) {
        await this.persistConversationMessage(input.sessionId, {
          id: generateId(),
          role: 'assistant',
          content: reply,
          timestamp: Date.now(),
        }, {
          storeVector: true,
          type: 'conversation',
          importance: 0.75,
          tags: ['assistant', 'reply'],
          userId: input.userId,
        });
      }

      this.setState('idle');
    } catch (err) {
      // 如果是 abort 触发的错误，状态保持 idle（已在 abort() 中设置）
      if (this.state === 'idle') {
        terminatedReason = 'aborted';
      } else {
        log.error({ err: (err as Error).message }, 'Lobster 循环执行失败');
        this.setState('error');
        terminatedReason = 'error';
        reply = `抱歉，处理过程中出现错误：${(err as Error).message}`;
      }
    } finally {
      this.abortController = null;
    }

    return {
      reply,
      iterations: this.loop.getIteration(),
      tokens: this.accumulatedTokens,
      terminatedReason,
      durationMs: Date.now() - startedAt,
      // reasoning 聚合:若所有轮都没有 reasoning,reasoning 为 undefined,TUI 不显示折叠区
      reasoning: aggregatedReasoning || undefined,
      reasoningDurationMs:
        aggregatedReasoning && reasoningStartedAt !== null && reasoningEndedAt !== null
          ? reasoningEndedAt - reasoningStartedAt
          : undefined,
      stepEvents,
      executionTrace: this.executionTraceInternal,
      completed: terminatedReason === 'completed',
    };
  }

  // ═════════════════════════════════════════════════════════════
  // 六阶段实现
  // ═════════════════════════════════════════════════════════════

  /**
   * 阶段 1：感知（Perceive）
   *
   * 加载 Session 短期记忆、Vector 长期记忆，拼接完整上下文。
   */
  private async phasePerceive(
    input: AgentRunInput,
    record: (phase: LoopPhase, detail: string) => void,
    _currentMessages: LLMMessage[],
  ): Promise<void> {
    const startTime = Date.now();

    // ── 加载会话历史 ──
    // 关键修复：如果 Gateway 已通过 input.history 注入了真实历史（用户前端显示的内容），
    // 则优先使用它，不再从独立的 sessionMemory（另一套存储）重复读取，
    // 否则会出现 LLM 感知上下文与用户所见不一致（"会话历史引用错误"）。
    const hasGatewayHistory = Array.isArray(input.history) && input.history.length > 0;
    let historyCount = hasGatewayHistory ? input.history!.length : 0;

    if (!hasGatewayHistory) {
      try {
        // 仅当没有网关历史时才回退到 sessionMemory（历史兼容场景）
        const history = await this.sessionMemory.read(input.sessionId);

        // 兼容真实 SessionMemory（返回 SessionData）和 Mock（返回 SessionMessage[]）
        let historyMessages: Array<{ role: string; content: string; timestamp?: number }> = [];
        if (Array.isArray(history)) {
          // Mock 直接返回消息数组
          historyMessages = history;
        } else if (history && 'messages' in history) {
          // 真实 SessionMemory 返回 SessionData
          const data = history as any;
          historyMessages = data.messages ?? [];
        }

        historyCount = historyMessages.length;

        for (const hMsg of historyMessages.slice(-20)) {
          // 避免重复添加
          const alreadyIn = _currentMessages.some(
            (m) => m.role === 'user' && m.content === hMsg.content,
          );
          if (alreadyIn) continue;
          // 只接受 user/assistant;tool 改写为 user(包装成人类可读)
          const normalizedRole: 'user' | 'assistant' =
            hMsg.role === 'assistant' ? 'assistant' : 'user';
          const normalizedContent =
            hMsg.role === 'tool'
              ? `[历史工具结果] ${hMsg.content}`
              : hMsg.content;
          _currentMessages.splice(
            1 + (_currentMessages.length - 1 > 0 ? input.history?.length ?? 0 : 0),
            0,
            { role: normalizedRole, content: normalizedContent },
          );
        }
      } catch (err) {
        log.warn({ err: (err as Error).message }, '会话历史加载失败，继续使用当前上下文');
      }
    }

    // 检索长期向量记忆（按 userId 过滤，确保跨会话记忆可检索）
    // 使用 userId 而非 sessionId，这样用户在新会话中也能检索到之前会话的记忆
    // 仅在 userId 有效时才过滤，避免 'unknown' 等无效值导致检索不到任何记忆
    let vectorMemoryCount = 0;
    try {
      const searchOptions: Record<string, unknown> = { topK: 5 };
      if (input.userId && input.userId !== 'unknown') {
        searchOptions.userId = input.userId;
      }
      const memories = this.vectorMemory instanceof VectorMemory
        ? await this.vectorMemory.search(input.message, searchOptions as any)
        : await this.vectorMemory.search(input.message, 5);
      vectorMemoryCount = memories.length;
      if (memories.length > 0) {
        // 将检索到的长期记忆注入系统提示词
        // 兼容真实 VectorMemory（返回 VectorMemoryEntry[]）和 Mock（返回 string[]）
        const memoryTexts = memories.map((m) =>
          typeof m === 'string' ? m : `[记忆 ${(m as any).score?.toFixed?.(2) ?? '?'}] ${(m as any).content ?? m}`
        );
        const systemIdx = _currentMessages.findIndex((m) => m.role === 'system');
        if (systemIdx >= 0) {
          const memoryContext = '\n\n[长期记忆]\n' + memoryTexts.map((t) => `- ${t}`).join('\n');
          _currentMessages[systemIdx] = {
            ..._currentMessages[systemIdx],
            content: (_currentMessages[systemIdx].content as string) + memoryContext,
          };
        }
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, '向量记忆检索失败');
    }

    const durationMs = Date.now() - startTime;
    this.addExecutionStep({
      phase: 'perceive',
      durationMs,
      status: 'success',
      output: { historyCount, vectorMemoryCount },
    });

    record('perceive', `received message from ${input.userId} (历史 ${historyCount} 条, 记忆 ${vectorMemoryCount} 条)`);

    // 触发 Hook
    await this.triggerHook('message.pre', {
      message: {
        id: '',
        channelId: input.channelId,
        userId: input.userId,
        sessionId: input.sessionId,
        type: 'text',
        role: 'user',
        content: input.message,
        attachments: [],
        timestamp: Date.now(),
        metadata: {},
      } as unknown as Message,
    });
  }

  /**
   * 阶段 2：思考（Think）
   *
   * 注入系统提示词、Skills/Tools 清单，调用 LLM 推理。
   */
  private async phaseThink(
    messages: LLMMessage[],
    _plannerContext: PlannerContext,
    record: (phase: LoopPhase, detail: string) => void,
    runOptions?: AgentRunOptions,
  ): Promise<{ output: LLMChatOutput; thinkStartedAt: number; thinkEndedAt: number }> {
    const startTime = Date.now();
    record('think', 'calling LLM');

    // 关键:不传 tools 给 LLM,避免 LLM 走 OpenAI function_calling 模式
    // — 我们的 Planner 只解析 XML <action> 标签,function_calling 返回的 toolCalls
    //   会被忽略,导致 LLM "想用工具"但没真用,reply = llmOutput(LLM 解释文字)
    // — 工具列表在 buildSystemPrompt 里以 XML 形式列出,LLM 知道有哪些可用
    const llmInput: LLMChatInput = {
      messages,
      signal: this.abortController?.signal,
      // P1.3: intensity -> temperature / maxTokens / deepseek.reasoningEffort
      // model 字段透传到 options.model, 由 adapter 决定是否覆盖 this.model
      options: this.buildLLMOptionsFromRunOptions(runOptions),
    };

    // 触发 LLM 前置 Hook
    await this.triggerHook('llm.pre', {
      prompt: messages.map((m) => m.content).join('\n'),
      model: this.llm.model,
    });

    // ── 关键:在 LLM 调用前后打时间戳,让 reasoning 计时有意义 ──
    const thinkStartedAt = Date.now();
    const output = await this.llm.chat(llmInput);
    const thinkEndedAt = Date.now();

    const durationMs = Date.now() - startTime;

    // 触发 LLM 后置 Hook
    await this.triggerHook('llm.post', {
      prompt: messages.map((m) => m.content).join('\n'),
      response: output.content,
      model: output.model,
      tokensIn: output.usage.promptTokens,
      tokensOut: output.usage.completionTokens,
      durationMs,
    });

    this.addExecutionStep({
      phase: 'think',
      durationMs,
      status: 'success',
      output: { tokens: output.usage, hasToolCalls: !!output.toolCalls?.length },
    });

    record('think', `LLM responded (${output.usage.totalTokens} tokens)`);

    return { output, thinkStartedAt, thinkEndedAt };
  }

  /**
   * 阶段 3：规划（Plan）
   *
   * 解析 LLM 输出，拆解子任务队列，安全校验。
   */
  private async phasePlan(
    llmOutput: string,
    plannerContext: PlannerContext,
    record: (phase: LoopPhase, detail: string) => void,
  ): Promise<PlannerSubTask[]> {
    const startTime = Date.now();

    // 调用 Planner 解析 LLM 输出
    const tasks = await this.planner.plan(llmOutput, plannerContext);

    const durationMs = Date.now() - startTime;

    if (tasks.length === 0) {
      record('plan', '无子任务生成，LLM 直接回复');
      this.addExecutionStep({
        phase: 'plan',
        durationMs,
        status: 'success',
        output: { taskCount: 0, directReply: true },
      });
    } else {
      record('plan', `生成 ${tasks.length} 个子任务`);
      this.addExecutionStep({
        phase: 'plan',
        durationMs,
        status: 'success',
        output: {
          taskCount: tasks.length,
          tasks: tasks.map((t) => ({ id: t.id, tool: t.tool, risk: t.risk })),
        },
      });
    }

    return tasks;
  }

  /**
   * 阶段 4：执行（Act）
   *
   * 按执行计划调用工具。组间串行，组内可视情况并行。
   */
  private async phaseAct(
    executionPlan: ExecutionPlan,
    input: AgentRunInput,
    record: (phase: LoopPhase, detail: string) => void,
  ): Promise<Array<{ result: unknown; success: boolean }>> {
    const results: Array<{ result: unknown; success: boolean }> = [];

    for (const group of executionPlan.groups) {
      if (group.parallel && group.tasks.length > 1) {
        // 并行执行组内任务
        record('act', `并行执行 ${group.tasks.length} 个工具`);
        const groupResults = await Promise.all(
          group.tasks.map((task) => this.executeSingleTool(task, input, record)),
        );
        results.push(...groupResults);
      } else {
        // 串行执行
        for (const task of group.tasks) {
          record('act', `执行工具: ${task.tool}`);
          const taskResult = await this.executeSingleTool(task, input, record);
          results.push(taskResult);
        }
      }
    }

    return results;
  }

  /**
   * 阶段 5：观察（Observe）
   *
   * 将工具执行结果结构化回填上下文。
   */
  private async phaseObserve(
    actResults: Array<{ result: unknown; success: boolean }>,
    input: AgentRunInput,
    record: (phase: LoopPhase, detail: string) => void,
  ): Promise<void> {
    const startTime = Date.now();
    const successCount = actResults.filter((r) => r.success).length;
    const failCount = actResults.length - successCount;

    // 将工具调用结果存入会话记忆
    // 关键:SessionMemory.role 必须是 LLM 可识别的 user/assistant,
    // 不能是 'tool'(与 ADR 0001 XML 协议不兼容,见 phasePerceive 的处理)。
    // 这里用 'user' 包装工具结果,与单次循环内 phaseAct 后的处理一致。
    try {
      const toolResultText = actResults
        .map((r, i) => `【工具执行结果】#${i + 1} ${r.success ? '成功' : '失败'}\n${typeof r.result === 'string' ? r.result : JSON.stringify(r.result ?? '')}`)
        .join('\n\n');
      await this.persistConversationMessage(input.sessionId, {
        id: generateId(),
        role: 'user',
        content: toolResultText,
        timestamp: Date.now(),
      }, {
        storeVector: false,
        userId: input.userId,
      });
    } catch (err) {
      log.warn({ err: (err as Error).message }, '工具结果写入会话记忆失败');
    }

    const durationMs = Date.now() - startTime;
    record('observe', `${successCount} 成功, ${failCount} 失败`);

    this.addExecutionStep({
      phase: 'observe',
      durationMs,
      status: 'success',
      output: { successCount, failCount },
    });
  }

  /**
   * 阶段 6：反思（Reflect）
   *
   * LLM 判断任务是否完成，决定继续循环或终止。
   */
  private async phaseReflect(
    messages: LLMMessage[],
    _plannerContext: PlannerContext,
    record: (phase: LoopPhase, detail: string) => void,
    runOptions?: AgentRunOptions,
  ): Promise<{ complete: boolean; content: string }> {
    const startTime = Date.now();

    // 构建反思提示词
    const reflectPrompt: LLMMessage = {
      role: 'user',
      content: [
        '请基于以上工具调用的结果，综合判断任务是否已经完成。',
        '',
        '如果任务已完成，请生成最终回复并直接回复用户，以 <final_answer> 开头标注。',
        '如果任务还需要补充信息或修正，请说明并生成下一步操作。',
        '',
        '回复格式要求：',
        '- 如果完成，直接以自然语言回复用户',
        '- 如果未完成，说明需要什么并生成新的 <action> 指令',
      ].join('\n'),
    };

    try {
      const reflectMessages = [...messages, reflectPrompt];
      const reflectInput: LLMChatInput = {
        messages: reflectMessages,
        signal: this.abortController?.signal,
        // P1.3: reflect 也用 intensity 调参 (但温度低一些, 保持判断稳定)
        options: this.buildLLMOptionsFromRunOptions(runOptions, { reflect: true }),
      };

      const reflectOutput = await this.llm.chat(reflectInput);

      const durationMs = Date.now() - startTime;

      // 判断任务是否完成：有 explicit final_answer 标记 或 Reflect 不再产生新的 tool calls
      const isComplete =
        !reflectOutput.toolCalls?.length &&
        (reflectOutput.content.includes('<final_answer>') ||
          // 如果 Reflect 没有 tool calls 且没有 action 标签，认为完成
          (!reflectOutput.content.includes('<action') &&
            !reflectOutput.content.includes('<thought>还需要')));

      record('reflect', isComplete ? '任务完成' : '任务未完成，继续下一轮');

      this.addExecutionStep({
        phase: 'reflect',
        durationMs,
        status: 'success',
        output: { complete: isComplete },
      });

      return { complete: isComplete, content: reflectOutput.content };
    } catch (err) {
      // Reflect 阶段出错时，保守地认为任务完成
      const durationMs = Date.now() - startTime;
      log.warn({ err: (err as Error).message }, 'Reflect 阶段调用失败，假设任务完成');

      this.addExecutionStep({
        phase: 'reflect',
        durationMs,
        status: 'failed',
        output: { error: (err as Error).message },
      });

      // 从消息中提取最后的 assistant 回复
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      return { complete: true, content: typeof lastAssistant?.content === 'string' ? lastAssistant.content : '' };
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 工具执行
  // ═════════════════════════════════════════════════════════════

  /**
   * 执行单个工具任务
   */
  private async executeSingleTool(
    task: PlannerSubTask,
    input: AgentRunInput,
    record: (phase: LoopPhase, detail: string) => void,
  ): Promise<{ result: unknown; success: boolean }> {
    const startTime = Date.now();

    // 触发 Tool 前置 Hook
    await this.triggerHook('tool.pre', {
      toolName: task.tool,
      args: task.params,
    });

    try {
      // 构造完整的 InvokeContext（包含 permissions 和 allowedPaths），
      // 以触发真实 ToolRegistry 的安全校验机制（路径白名单 + 风险等级判断）
      // ── 关键修复：透传工具自身的 timeout 参数到 InvokeContext.timeoutMs ──
      // 解决问题：LLM 在 <action args={"timeout": 5000}> 中指定的超时
      //   - 之前只传给 exec/shell 的 child_process（内层超时）
      //   - 但 ToolRegistry.invoke 的外层超时默认 60 秒，内层超时 5 秒会先触发
      //   - 若 LLM 指定 120 秒，外层 60 秒会先 kill 工具，导致 "工具执行超时" 误报
      // 现在：把工具 params.timeout 透传到 InvokeContext，让外层超时 ≥ 内层超时
      const toolTimeout = typeof task.params?.timeout === 'number'
        ? task.params.timeout
        : undefined;
      const invokeContext: InvokeContext = {
        sessionId: input.sessionId,
        userId: input.userId,
        channelId: input.channelId,
        permissions: this.getDefaultPermissions(),
        allowedPaths: this.getAllowedPaths(),
        config: {},
        // 外层超时 = max(工具指定超时, 默认 60s) + 5s 缓冲，确保内层先完成
        timeoutMs: toolTimeout ? toolTimeout + 5000 : 120000,
      };

      // 使用 invoke 接口（Mock 与真实 ToolRegistry 均实现此方法）
      const toolResult = await this.toolRegistry.invoke(
        task.tool,
        task.params,
        invokeContext,
      );

      const durationMs = Date.now() - startTime;

      // 触发 Tool 后置 Hook
      await this.triggerHook('tool.post', {
        toolName: task.tool,
        args: task.params,
        result: toolResult.result,
        durationMs,
      });

      const step: ExecutionStep = {
        index: this.nextStepIndex(),
        phase: 'act',
        tool: task.tool,
        params: task.params,
        output: toolResult.result,
        durationMs,
        status: toolResult.success ? 'success' : 'failed',
      };
      this.executionTraceInternal.push(step);

      return { result: toolResult.result, success: toolResult.success };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = (err as Error).message;

      const step: ExecutionStep = {
        index: this.nextStepIndex(),
        phase: 'act',
        tool: task.tool,
        params: task.params,
        output: errorMsg,
        durationMs,
        status: 'failed',
      };
      this.executionTraceInternal.push(step);

      record('act', `工具 ${task.tool} 执行失败: ${errorMsg}`);

      return { result: errorMsg, success: false };
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 中止与重置
  // ═════════════════════════════════════════════════════════════

  /**
   * 中断当前循环
   */
  async abort(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort(new Error('user abort'));
      this.loop.abort('user abort');
    }
    this.setState('idle');
  }

  /**
   * 重置 Agent 状态，清空当前会话上下文
   */
  async reset(): Promise<void> {
    this.loop.reset();
    this.executionStepIndex = 0;
    this.executionTraceInternal = [];
    this.accumulatedTokens = { prompt: 0, completion: 0, total: 0 };
    this.setState('idle');
  }

  // ═════════════════════════════════════════════════════════════
  // 内部组件访问器（供 HTTP API / CLI 等外部模块查询能力清单）
  // ═════════════════════════════════════════════════════════════

  /**
   * 获取工具注册中心引用
   *
   * 供 HTTP API（/api/tools）等外部模块查询当前可用工具清单使用。
   * 返回的引用为只读用途，调用方不应直接通过此引用执行工具，
   * 工具执行仍应通过 invoke() 方法并传递完整 InvokeContext。
   *
   * @returns 工具注册中心实例（MockToolRegistry | ToolRegistry）
   */
  getToolRegistry(): MockToolRegistry | ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * 获取技能注册中心引用
   *
   * 供 HTTP API（/api/skills）等外部模块查询当前可用技能清单使用。
   *
   * @returns 技能注册中心实例（MockSkillRegistry | SkillRegistry）
   */
  getSkillRegistry(): MockSkillRegistry | SkillRegistry {
    return this.skillRegistry;
  }

  // ═════════════════════════════════════════════════════════════
  // 事件监听
  // ═════════════════════════════════════════════════════════════

  /**
   * 注册状态变更监听器
   *
   * @param listener 状态变更回调
   * @returns 取消监听的函数
   */
  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /**
   * 注册步骤执行监听器
   *
   * @param listener 步骤变更回调
   * @returns 取消监听的函数
   */
  onStep(listener: StepListener): () => void {
    this.stepListeners.add(listener);
    return () => this.stepListeners.delete(listener);
  }

  // ═════════════════════════════════════════════════════════════
  // 辅助方法
  // ═════════════════════════════════════════════════════════════

  /** 安全规划检查入口（提供给上层调用） */
  isActionSafe(toolName: string): boolean {
    return this.planner.isActionSafe(toolName);
  }

  /**
   * P1.3: 根据 runOptions 构造 LLMChatInput.options
   *
   * - intensity → temperature / maxTokens / (DeepSeek) reasoningEffort
   * - model → options.model (由 adapter 决定是否覆盖 this.model)
   * - reflect 模式温度统一降到 0.5 (Reflect 要稳定, 不要创新)
   * - 默认 (无 intensity) → think 用 0.7/4096, reflect 用 0.5/2048 (跟原行为一致)
   */
  private buildLLMOptionsFromRunOptions(
    runOptions?: AgentRunOptions,
    opts: { reflect?: boolean } = {},
  ): { temperature: number; maxTokens: number; model?: string } {
    const intensityOpts = intensityToLLMOptions(runOptions?.intensity);
    const model = runOptions?.model;
    // 默认值 (无 intensity 时)
    if (!intensityOpts.temperature) {
      return {
        temperature: opts.reflect ? 0.5 : 0.7,
        maxTokens: opts.reflect ? 2048 : 4096,
        ...(model ? { model } : {}),
      };
    }
    // 有 intensity → 用映射值, reflect 温度强制 0.5
    return {
      temperature: opts.reflect ? 0.5 : (intensityOpts.temperature ?? 0.7),
      maxTokens: intensityOpts.maxTokens ?? (opts.reflect ? 2048 : 4096),
      ...(model ? { model } : {}),
    };
  }

  /** 构造系统提示词（集成真实 SkillRegistry 的 buildPrompt） */
  private buildSystemPrompt(input: AgentRunInput): string {
    // ── 优先级 1：用户主动激活的技能（优先注入完整说明） ──
    // 这些技能来自 Web 端技能面板明确勾选，不再依赖 triggers 猜测
    let activeSkillsPrompt = '';
    if (this.skillRegistry instanceof SkillRegistry && input.activatedSkills && input.activatedSkills.length > 0) {
      activeSkillsPrompt = this.skillRegistry.buildPromptFromActiveSkills(input.activatedSkills);
    }

    // ── 优先级 2：基于 triggers 关键词匹配（兼容纯文本模式） ──
    let triggerSkillsPrompt = '';
    if (this.skillRegistry instanceof SkillRegistry) {
      triggerSkillsPrompt = this.skillRegistry.buildPrompt(input.message);
    } else {
      // 兼容 MockSkillRegistry
      const skillList = this.skillRegistry.listAll();
      triggerSkillsPrompt = skillList.length > 0
        ? '\n## 可用技能\n\n' + skillList.map((s) => `- **${s.meta.name}**: ${s.meta.description}`).join('\n') + '\n'
        : '\n（暂无可用技能）\n';
    }

    // ── 用户主动激活的工具（在工具描述前突出展示） ──
    const activeToolsPrompt = this.buildActiveToolsPrompt(input.activatedTools);

    const toolList = this.toolRegistry.listAll();
    // 工具描述含完整参数 schema,LLM 才能写出合法的 args JSON
    const toolsDesc = toolList.length > 0
      ? toolList.map((t: any) => {
          const params = (t.parameters ?? t.inputSchema ?? {}) as Record<string, unknown>;
          const paramsStr = Object.keys(params).length > 0
            ? '\n   参数 schema: ' + JSON.stringify(params, null, 0)
            : '';
          const activeMark = input.activatedTools?.includes(t.name) ? ' ⭐用户主动激活' : '';
          return `- \`${t.name}\`${activeMark}: ${t.description}${paramsStr}`;
        }).join('\n')
      : '（暂无可用工具 — 直接用自然语言回复用户即可）';

    // ── 工作模式命令（Spec/Plan）强约束指令注入 ──
    const commandPrompt = buildWorkModeCommandPrompt(input.workModeCommand);

    return [
      `你是 ${this.agentName}，${this.agentRole}。`,
      '',
      '## 输出格式(必须严格遵守,这是协议约束不是建议)',
      '你必须用 XML 标签结构化输出,**不要**使用 function_call / tool_call 形式。',
      '系统不会响应 function_call — 用了等于没调用,只是浪费一轮。',
      '',
      '```',
      '<thought>对用户请求的分析与思考过程</thought>',
      '<action name="工具名" args=\'{"参数":"值"}\' />   ← 需要调工具时',
      '<final_answer>任务完成后的最终回复(仅当任务完成时使用)</final_answer>',
      '```',
      '',
      '## 关键规则',
      '1. 始终先用 <thought> 分析用户请求(必填)',
      '2. 如果不需要任何工具(简单问答/聊天),只输出 <thought> + <final_answer>',
      '3. 如果需要工具,用 <action name="..." args=\'{...}\' /> 指定,**一次只能输出一个 action**',
      '4. args 必须是合法 JSON 字符串,值用双引号包',
      '5. 工具调用完后,系统会再调你一次(Reflect 阶段),那时再决定 <action> 或 <final_answer>',
      '6. <final_answer> 只能出现一次,放在最后,内容是给用户看的最终回复',
      '7. 文件操作前先检查路径安全性',
      '8. 遇到错误时主动说明原因并尝试修正',
      '9. 如果用户询问当前时间、几点、现在几点、当前日期，请优先调用 system/time 工具，不要依赖记忆或历史消息中的时间',
      '',
      // 用户主动激活的技能（最高优先级）
      activeSkillsPrompt,
      // 基于 triggers 关键词匹配（次优先级）
      '## 可用技能',
      triggerSkillsPrompt,
      // 主动激活的工具提示
      activeToolsPrompt,
      '',
      '## 可用工具',
      toolsDesc,
      '',
      `会话 ID: ${input.sessionId}`,
      `渠道: ${input.channelId}`,
      '',
      '请开始处理用户请求。',
      // P1.3: 客户端 (TUI) 切到 plan/build 时, 注入对应的模式指令
      workModeSystemPromptAddon(input.runOptions?.workMode),
      // Spec/Plan 快捷命令的强约束指令
      commandPrompt,
    ].filter((s) => s !== '').join('\n');
  }

  private async persistConversationMessage(
    sessionId: string,
    message: { id: string; role: 'user' | 'assistant'; content: string; timestamp: number },
    options: { storeVector?: boolean; type?: 'conversation' | 'task' | 'knowledge'; importance?: number; tags?: string[]; userId?: string } = {},
  ): Promise<void> {
    try {
      await this.sessionMemory.append(sessionId, message);

      if (options.storeVector && this.vectorMemory instanceof VectorMemory) {
        // 优先使用传入的 userId，其次从会话数据中读取
        let resolvedUserId = options.userId;
        if (!resolvedUserId) {
          const sessionData = await this.sessionMemory.read(sessionId);
          resolvedUserId = sessionData && !Array.isArray(sessionData) && 'userId' in sessionData
            ? (sessionData.userId ?? 'unknown')
            : 'unknown';
        }
        await this.vectorMemory.store({
          content: message.content,
          metadata: {
            sessionId,
            userId: resolvedUserId,
            type: options.type ?? 'conversation',
            importance: options.importance ?? 0.5,
            tags: options.tags,
            createdAt: message.timestamp,
          },
        });
      }
    } catch (err) {
      log.warn({ err: (err as Error).message, sessionId, role: message.role }, '会话记忆写入失败');
    }
  }

  private async ensureSessionContext(input: AgentRunInput): Promise<void> {
    if (!(this.sessionMemory instanceof SessionMemory)) {
      return;
    }

    try {
      const existing = await this.sessionMemory.read(input.sessionId);
      if (!existing) {
        await this.sessionMemory.create(input.sessionId, {
          userId: input.userId,
          channelId: input.channelId,
          agentId: 'default',
        });
      } else {
        await this.sessionMemory.updateSessionContext(input.sessionId, {
          userId: input.userId,
          channelId: input.channelId,
          agentId: 'default',
        });
      }
    } catch (err) {
      log.warn({ err: (err as Error).message, sessionId: input.sessionId }, '初始化会话上下文失败');
    }
  }

  /** 构建规划上下文 */
  private buildPlannerContext(input: AgentRunInput): PlannerContext {
    const tools = this.toolRegistry.listAll();
    const toolDescriptors: ToolDescriptor[] = tools.map((t: any) => ({
      name: t.name,
      description: t.description,
      parameters: (t.parameters ?? t.inputSchema ?? {}) as Record<string, unknown>,
      risk: (t.risk ?? this.estimateToolRisk(t.name)) as 'low' | 'medium' | 'high',
      builtin: (t.builtin ?? true) as boolean,
    }));

    return {
      sessionId: input.sessionId,
      userMessage: input.message,
      availableTools: toolDescriptors,
      // 默认权限（与 executeSingleTool 中保持一致）
      permissions: this.getDefaultPermissions(),
      allowedPaths: this.getAllowedPaths(),
      // 用户自定义配置覆盖默认值
      ...this.plannerContextConfig,
    };
  }

  /**
   * 获取默认用户权限
   *
   * 允许所有已注册工具分类（含 routing 和 calculator），最大自动风险等级为 medium。
   * 与 executeSingleTool 中传递给 invoke 的 permissions 保持一致。
   *
   * @returns UserPermissions 对象
   */
  private getDefaultPermissions(): UserPermissions {
    return {
      allowedCategories: [
        'fs', 'exec', 'http', 'browser', 'memory_search',
        'system', 'weather', 'utility', 'routing', 'calculator',
      ],
      maxAutoRisk: 'medium',
    };
  }

  /**
   * 获取允许访问的工作目录白名单
   *
   * 优先使用 plannerContextConfig 中的自定义配置，回退到 planner 的 allowedPaths。
   * 与 executeSingleTool 中传递给 invoke 的 allowedPaths 保持一致。
   *
   * @returns 路径白名单数组
   */
  private getAllowedPaths(): string[] {
    return this.plannerContextConfig.allowedPaths ?? this.planner.allowedPaths ?? [];
  }

  /** 设置状态并通知监听器 */
  private setState(state: AgentState): void {
    this.state = state;
    this.stateListeners.forEach((l) => l(state));
    log.debug({ state }, 'Agent 状态变更');
  }

  /** 评估工具风险等级 */
  private estimateToolRisk(name: string): 'low' | 'medium' | 'high' {
    if (name === 'exec/root' || name === 'fs/rm_rf' || name.startsWith('fs/delete')) {
      return 'high';
    }
    if (name.startsWith('exec/') || name.startsWith('fs/write') || name.startsWith('http/')) {
      return 'medium';
    }
    return 'low';
  }

  /** 获取下一个执行步骤序号 */
  private nextStepIndex(): number {
    return ++this.executionStepIndex;
  }

  /** 添加执行步骤记录 */
  private addExecutionStep(step: Omit<ExecutionStep, 'index'>): void {
    this.executionTraceInternal.push({
      index: this.nextStepIndex(),
      ...step,
    });
  }

  /**
   * 触发 Hook 管线
   */
  private async triggerHook(
    event: HookEvent,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.hookPipeline) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.hookPipeline as any).execute(event, data);
    } catch (err) {
      log.warn({ event, err: (err as Error).message }, 'Hook 执行失败');
    }
  }

  /**
   * 构造用户主动激活工具的强调提示词
   *
   * 在系统提示词中单独列出用户在技能面板勾选的工具，
   * 提示 LLM 优先考虑使用这些工具解决任务。
   */
  private buildActiveToolsPrompt(toolNames?: string[]): string {
    if (!toolNames || toolNames.length === 0) return '';

    const lines: string[] = ['', '## 用户主动激活的工具（优先调用）', ''];
    const toolList = this.toolRegistry.listAll();
    let matched = 0;
    for (const name of toolNames) {
      const tool = toolList.find((t: any) => t.name === name);
      if (!tool) {
        log.warn({ name }, '主动激活的工具在注册中心中未找到，跳过');
        continue;
      }
      matched++;
      const params = ((tool as any).parameters ?? (tool as any).inputSchema ?? {}) as Record<string, unknown>;
      const paramsStr = Object.keys(params).length > 0
        ? '\n   参数 schema: ' + JSON.stringify(params, null, 0)
        : '';
      lines.push(`- ⭐ \`${tool.name}\`: ${tool.description}${paramsStr}`);
    }
    if (matched === 0) return '';
    lines.push('');
    lines.push('> 说明：请优先调用上述「用户主动激活的工具」，若其无法满足任务再使用其他工具。');
    return lines.join('\n');
  }
}

/**
 * 构造 Spec/Plan 工作模式命令的强约束提示词
 *
 * 用户在 Web 端技能面板选择「Spec」或「Plan」快捷命令后，
 * 会触发对应的强约束工作流，不再使用默认的 ReAct 模式。
 */
function buildWorkModeCommandPrompt(command?: 'spec' | 'plan'): string {
  if (!command) return '';

  if (command === 'spec') {
    return [
      '',
      '## 🔴 Spec 模式指令（必须严格遵守）',
      '在本消息中，用户强制启用了 **Spec 规范模式**：',
      '1. **第一步（必须）**：输出任务的详细规范说明（Spec）。',
      '   - 包括：需求目标、输入输出、边界条件、成功标准、异常处理策略。',
      '   - 该步骤只输出思考与规范文本，不执行任何操作。',
      '2. **第二步（必须）**：向用户展示规范并请求：「请确认上述规范是否符合预期？若确认，我将开始按规范执行。」',
      '3. **禁止跳过**：在用户未确认之前，**不得**执行具体工具调用、代码修改或实际操作。',
      '4. 在本消息轮中以 <final_answer> 输出规范说明 + 确认请求即可，不要写任何 <action>。',
      '',
    ].join('\n');
  }

  // plan 模式
  return [
    '',
    '## 🟣 Plan 模式指令（必须严格遵守）',
    '在本消息中，用户强制启用了 **Plan 规划模式**：',
    '1. **第一步（必须）**：输出任务的详细执行计划（Plan）。',
    '   - 拆解为 3~8 个有序步骤，每一步写明：做什么、预期产出、依赖条件、失败回退策略。',
    '   - 列出需要调用的工具与参数大纲（无需实际调用）。',
    '2. **第二步（必须）**：向用户展示计划并请求：「请确认上述计划是否可行？若确认，我将按计划逐步执行。」',
    '3. **禁止跳过**：在用户未确认之前，**不得**执行具体工具调用、代码修改或实际操作。',
    '4. 在本消息轮中以 <final_answer> 输出计划 + 确认请求即可，不要写任何 <action>。',
    '',
  ].join('\n');
}
