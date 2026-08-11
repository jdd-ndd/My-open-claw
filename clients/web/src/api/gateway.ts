import type { GatewayMessage, RequestMessage, ConnectionStatus } from '@/types/gateway';

export interface GatewayConfig {
  wsUrl: string;
  httpUrl: string;
}

interface WebSocketConfig {
  url: string;
  connectTimeout?: number;
  heartbeat?: { interval: number; timeout: number };
  reconnect?: { initialDelay: number; maxDelay: number; multiplier: number; maxAttempts: number };
}

type MessageHandler<T = unknown> = (message: GatewayMessage<T>) => void;

export class MyOpenClawWebSocketClient {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketConfig>;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private pendingRequests: Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }
  > = new Map();
  private connectionState: ConnectionStatus = 'idle';
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private stateChangeCallbacks: Set<(state: ConnectionStatus) => void> = new Set();
  private connectingPromise: Promise<void> | null = null;

  constructor(config: WebSocketConfig) {
    this.config = {
      connectTimeout: 10000,
      heartbeat: { interval: 30000, timeout: 10000 },
      reconnect: { initialDelay: 1000, maxDelay: 30000, multiplier: 2, maxAttempts: 10 },
      ...config,
    };
  }

  get state(): ConnectionStatus {
    return this.connectionState;
  }

  onStateChange(callback: (state: ConnectionStatus) => void): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => this.stateChangeCallbacks.delete(callback);
  }

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    this.setState('connecting');

    this.connectingPromise = new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.url);
      } catch (err) {
        this.setState('disconnected');
        this.connectingPromise = null;
        reject(err);
        return;
      }

      const timeoutTimer = setTimeout(() => {
        this.ws?.close();
        this.setState('disconnected');
        this.connectingPromise = null;
        reject(new Error(`WebSocket 连接超时（${this.config.connectTimeout}ms）`));
      }, this.config.connectTimeout);

      this.ws.onopen = () => {
        clearTimeout(timeoutTimer);
        this.setState('connected');
        this.reconnectAttempt = 0;
        this.startHeartbeat();
        this.connectingPromise = null;
        resolve();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = (event) => {
        clearTimeout(timeoutTimer);
        this.stopHeartbeat();
        this.setState('disconnected');
        this.connectingPromise = null;
        // 关闭时 reject 所有 pending request — 否则重连后旧 request 永远 pending
        this.rejectAllPending(new Error(`WebSocket 关闭 (code=${event.code})`));
        if (!event.wasClean) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        clearTimeout(timeoutTimer);
        this.setState('disconnected');
        this.connectingPromise = null;
        reject(new Error('WebSocket 连接发生错误'));
      };
    });

    return this.connectingPromise;
  }

  async request<T = unknown>(action: string, payload: unknown, timeout = 30000): Promise<T> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接，无法发送请求');
    }

    const requestId = crypto.randomUUID();
    const message: RequestMessage<unknown> = {
      id: crypto.randomUUID(),
      type: 'request',
      action,
      payload,
      timestamp: new Date().toISOString(),
      requestId,
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`请求超时（${timeout}ms）：${action}`));
      }, timeout);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.ws!.send(JSON.stringify(message));
    });
  }

  send(action: string, payload: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接');
    }

    const message: GatewayMessage<unknown> = {
      id: crypto.randomUUID(),
      type: 'request',
      action,
      payload,
      timestamp: new Date().toISOString(),
    };

    this.ws.send(JSON.stringify(message));
  }

  on<T = unknown>(event: string, handler: MessageHandler<T>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as MessageHandler);
  }

  off<T = unknown>(event: string, handler: MessageHandler<T>): void {
    this.handlers.get(event)?.delete(handler as MessageHandler);
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectAllPending(new Error('客户端主动断开'));
    this.ws?.close(1000, '客户端主动断开');
    this.ws = null;
    this.setState('idle');
  }

  /** reject 所有 pending request(在 close / disconnect 时调用) */
  private rejectAllPending(reason: Error): void {
    if (this.pendingRequests.size === 0) return;
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(reason);
      this.pendingRequests.delete(requestId);
    }
  }

  private setState(state: ConnectionStatus): void {
    this.connectionState = state;
    this.stateChangeCallbacks.forEach((cb) => cb(state));
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as GatewayMessage<unknown> & Record<string, unknown>;

      if (!message.id || !message.type) {
        console.warn('[WebSocket] 收到格式无效的消息:', data);
        return;
      }

      if (message.type === 'pong') {
        if (this.heartbeatTimeoutTimer) {
          clearTimeout(this.heartbeatTimeoutTimer);
          this.heartbeatTimeoutTimer = null;
        }
        return;
      }

      if (message.type === 'response' && 'requestId' in message) {
        const requestId = message.requestId as string;
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(requestId);
          const resp = message as unknown as { status: string; error?: { message: string }; payload: unknown };
          if (resp.status === 'error') {
            pending.reject(new Error(resp.error?.message || '请求失败'));
          } else {
            pending.resolve(resp.payload);
          }
        }
      } else if (message.type === 'event') {
        const eventName = (message.event as string) ?? (message.action as string);
        if (eventName) {
          const eventHandlers = this.handlers.get(eventName);
          if (eventHandlers) {
            eventHandlers.forEach((handler) => {
              try { handler(message); } catch (err) {
                console.error(`[WebSocket] 事件处理器错误 (${eventName}):`, err);
              }
            });
          }
        }
      }
    } catch (err) {
      console.error('[WebSocket] 消息解析失败:', err);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        this.heartbeatTimeoutTimer = setTimeout(() => {
          console.warn('[WebSocket] 心跳超时');
          this.ws?.close();
        }, this.config.heartbeat.timeout);
      }
    }, this.config.heartbeat.interval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.heartbeatTimeoutTimer) { clearTimeout(this.heartbeatTimeoutTimer); this.heartbeatTimeoutTimer = null; }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= this.config.reconnect.maxAttempts) {
      console.error('[WebSocket] 达到最大重连次数，放弃重连');
      this.setState('disconnected');
      return;
    }

    this.setState('reconnecting');

    const delay = Math.min(
      this.config.reconnect.initialDelay * Math.pow(this.config.reconnect.multiplier, this.reconnectAttempt),
      this.config.reconnect.maxDelay
    );

    console.log(`[WebSocket] ${delay}ms 后尝试第 ${this.reconnectAttempt + 1} 次重连...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempt++;
      this.connect().catch(() => { this.scheduleReconnect(); });
    }, delay);
  }
}

// 全局 WebSocket 单例
// 开发模式下通过 Vite 代理连接（/ws → ws://127.0.0.1:18780），
// 生产模式下直接连接到 gateway 端口
const isDev = import.meta.env.DEV;
const wsUrl = isDev
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:18780/ws`;

export const wsClient = new MyOpenClawWebSocketClient({ url: wsUrl });
