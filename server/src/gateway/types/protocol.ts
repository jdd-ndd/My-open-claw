/**
 * Gateway WebSocket 消息协议类型定义
 */

export const MessageDirection = {
  REQUEST: 'request',
  RESPONSE: 'response',
  EVENT: 'event',
  PING: 'ping',
  PONG: 'pong',
} as const;

export type MessageDirectionType = (typeof MessageDirection)[keyof typeof MessageDirection];

export interface BaseMessage {
  type: MessageDirectionType;
  id: string;
  timestamp: string;
}

export interface RequestMessage extends BaseMessage {
  type: 'request';
  action: string;
  requestId?: string;
  payload: Record<string, unknown>;
}

export interface ResponseMessage extends BaseMessage {
  type: 'response';
  requestId: string;
  status: 'success' | 'error';
  payload: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

export interface EventMessage extends BaseMessage {
  type: 'event';
  event: string;
  payload: Record<string, unknown>;
}

export interface PingMessage extends BaseMessage {
  type: 'ping';
}

export interface PongMessage extends BaseMessage {
  type: 'pong';
}

export type GatewayMessage = RequestMessage | ResponseMessage | EventMessage | PingMessage | PongMessage;
