/**
 * Gateway WebSocket 消息协议类型（重新导出桩）
 *
 * 类型定义已迁移至 types/protocol.ts。
 * 本文件保留向后兼容性。
 *
 * @module @myopenclaw/server/gateway
 */

export {
  MessageDirection,
  type MessageDirectionType,
  type BaseMessage,
  type RequestMessage,
  type ResponseMessage,
  type EventMessage,
  type GatewayMessage,
} from './types/protocol.js';
