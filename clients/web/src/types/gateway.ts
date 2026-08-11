export interface GatewayMessage<T = unknown> {
  id: string;
  type: 'request' | 'response' | 'event' | 'ping' | 'pong';
  action: string;
  payload: T;
  timestamp: string;
  requestId?: string;
}

export interface RequestMessage<T = unknown> extends GatewayMessage<T> {
  type: 'request';
}

export interface ResponseMessage<T = unknown> extends GatewayMessage<T> {
  type: 'response';
  requestId: string;
  status: 'success' | 'error';
  error?: { code: string; message: string };
}

export interface EventMessage<T = unknown> extends GatewayMessage<T> {
  type: 'event';
  event: string;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'reconnecting';
