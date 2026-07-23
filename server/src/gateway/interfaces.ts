/**
 * Gateway 对外接口定义
 *
 * @module @myopenclaw/server/gateway
 */

import type { NormalizedMessage } from './router/types.js';

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
}

/** 消息接收接口 */
export interface IMessageReceiver {
  receiveMessage(message: NormalizedMessage): Promise<MessageReceiveResult>;
}

/** Agent 调用接口 */
export interface IAgentInvoker {
  invoke(params: AgentInvokeParams): Promise<AgentInvokeResult>;
}
