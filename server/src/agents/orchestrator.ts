/**
 * Lobster Orchestrator — 主循环调度器
 *
 * 驱动 Agent 在 Perceive → Think → Plan → Act → Observe → Reflect 六阶段循环，
 * 维护 Agent 状态机（空闲 / 思考 / 执行 / 异常）。
 *
 * @module @myopenclaw/server/agents
 */

import { createLogger } from '../core/utils/logger.js';
import { LLM_TIMEOUT_MS } from '../core/constants/index.js';
import type { AgentState, Message } from '../core/types/index.js';
import { Planner } from './planner.js';
import { LLMAdapter } from './llm/index.js';

const log = createLogger('agent:orchestrator');

const DEFAULT_MAX_REACT_STEPS = 10;

export interface OrchestratorOptions {
  maxReActSteps?: number;
  llmTimeoutMs?: number;
}

export class AgentOrchestrator {
  private maxSteps: number;
  private llmTimeoutMs: number;
  private planner: Planner;
  private llm: LLMAdapter;

  constructor(options: OrchestratorOptions = {}) {
    this.maxSteps = options.maxReActSteps ?? DEFAULT_MAX_REACT_STEPS;
    this.llmTimeoutMs = options.llmTimeoutMs ?? LLM_TIMEOUT_MS;
    this.planner = new Planner();
    this.llm = new LLMAdapter();
  }

  /** 获取当前 Agent 工作状态 */
  state: AgentState = 'idle';

  /** 获取最大 ReAct 循环步数 */
  get maxReActSteps(): number {
    return this.maxSteps;
  }

  /** 获取 LLM 调用超时时间 */
  get llmTimeout(): number {
    return this.llmTimeoutMs;
  }

  /** 处理用户消息的主入口，驱动完整 Lobster 循环 */
  async processMessage(message: Message): Promise<Message> {
    log.info({ sessionId: message.sessionId }, '开始 Lobster 循环');
    this.state = 'thinking';

    // 占位：完整六阶段循环实现在后续 Agent Runtime 开发阶段完成
    // Perceive -> Think -> Plan -> Act -> Observe -> Reflect
    void this.planner;
    void this.llm;
    this.state = 'idle';

    return {
      ...message,
      role: 'agent',
      content: '[Agent 正在处理中...]',
    };
  }
}
