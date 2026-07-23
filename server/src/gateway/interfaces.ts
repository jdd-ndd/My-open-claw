/**
 * Gateway 对外接口定义（重新导出桩）
 *
 * 类型定义已迁移至 types/api.ts。
 * 本文件保留向后兼容性。
 *
 * @module @myopenclaw/server/gateway
 */

export type {
  GatewayStatus,
  MessageReceiveResult,
  AgentInvokeParams,
  AgentInvokeResult,
  IMessageReceiver,
  IAgentInvoker,
} from './types/api.js';
