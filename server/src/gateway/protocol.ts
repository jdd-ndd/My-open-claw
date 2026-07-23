/**
 * Gateway WebSocket 消息协议类型定义
 *
 * @module @myopenclaw/server/gateway
 */

/** 消息类型枚举 */
export const MessageDirection = {
  REQUEST: 'request',
  RESPONSE: 'response',
  EVENT: 'event',
} as const;

export type MessageDirectionType = (typeof MessageDirection)[keyof typeof MessageDirection];

/** 基础消息接口 */
export interface BaseMessage {
  type: MessageDirectionType;
  id: string;
  timestamp: string;
}

/** 请求消息 */
export interface RequestMessage extends BaseMessage {
  type: 'request';
  action: string;
  payload: Record<string, unknown>;
}

/** 响应消息 */
export interface ResponseMessage extends BaseMessage {
  type: 'response';
  requestId: string;
  status: 'success' | 'error';
  payload: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

/** 事件消息 */
export interface EventMessage extends BaseMessage {
  type: 'event';
  event: string;
  payload: Record<string, unknown>;
}

/** 网关消息联合类型 */
export type GatewayMessage = RequestMessage | ResponseMessage | EventMessage;
