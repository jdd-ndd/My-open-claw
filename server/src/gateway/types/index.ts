/**
 * Gateway 类型定义统一入口
 *
 * 集中管理所有子模块公用的类型定义，
 * 避免类型散落在 gateway 根级。
 *
 * @module @myopenclaw/server/gateway/types
 */

// 消息协议类型
export type {
  BaseMessage,
  RequestMessage,
  ResponseMessage,
  EventMessage,
  GatewayMessage,
} from './protocol.js';

export { MessageDirection } from './protocol.js';
export type { MessageDirectionType } from './protocol.js';

// 对外 API 接口
export type {
  GatewayStatus,
  MessageReceiveResult,
  AgentInvokeParams,
  AgentInvokeResult,
  IMessageReceiver,
  IAgentInvoker,
} from './api.js';
