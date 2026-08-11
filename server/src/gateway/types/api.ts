/**
 * Gateway 对外接口定义
 *
 * @module @myopenclaw/server/gateway/types
 */

import type { NormalizedMessage } from '../sessions/types.js';

/** Gateway 运行状态 */
export interface GatewayStatus {
  running: boolean;
  startedAt: number;
  uptime: number;
  version: string;
  wsEndpoint: string;
  httpEndpoint: string;
  agentCount: number;
  activeChannelCount: number;
  activeSessionCount: number;
  memoryUsage: number;
}

/** 消息接收结果 */
export interface MessageReceiveResult {
  success: boolean;
  sessionId?: string;
  agentId?: string;
  error?: string;
}

/** Agent 调用参数 */
export interface AgentInvokeParams {
  agentId: string;
  message: string;
  channelId?: string;
  userId?: string;
  sessionId?: string;
  taskId?: string;
}

/** Agent 调用结果 */
export interface AgentInvokeResult {
  response: string;
  sessionId: string;
  tokensUsed: number;
  duration: number;
  toolsCalled?: string[];
  /**
   * 思考过程(reasoning_content)汇总
   * 来自 Orchestrator 多轮 Think 阶段 LLM 输出的 reasoning_content 拼接
   * — 若模型(如 DeepSeek V3)不输出 reasoning,此字段为空字符串
   * — 若模型(如 DeepSeek R1)输出 reasoning,这里会聚合多轮思考并以 "\n\n---\n\n" 分隔
   * — 供 Gateway 层转 chat.reasoning_delta + chat.done.totalReasoning
   */
  reasoningContent?: string;
  /**
   * 思考过程累计耗时(毫秒)
   * 第一次 Think 开始到最后一次 Think 结束的时长
   */
  reasoningDurationMs?: number;
}

/** 消息接收接口 */
export interface IMessageReceiver {
  receiveMessage(message: NormalizedMessage): Promise<MessageReceiveResult>;
}

/** Agent 调用接口 */
export interface IAgentInvoker {
  invoke(params: AgentInvokeParams): Promise<AgentInvokeResult>;
}
