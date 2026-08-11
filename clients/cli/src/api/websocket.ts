import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { SHARED_CHANNEL_ID, SHARED_USER_ID } from '../config/sync-defaults.js';
import type {
  GatewayMessage,
  RequestMessage,
  ResponseMessage,
  EventMessage,
  ChatDeltaPayload,
  ChatDonePayload,
} from './types.js';

export const WebSocketEvent = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
  MESSAGE: 'message',
  RESPONSE: 'response',
  EVENT: 'event',
  CHAT_DELTA: 'chat.delta',
  CHAT_REASONING_DELTA: 'chat.reasoning_delta',
  CHAT_DONE: 'chat.done',
  CHAT_ERROR: 'chat.error',
  CHAT_MESSAGE_SENT: 'chat.message_sent',
  // 跨端会话同步事件（服务器在 REST CRUD 后广播）
  SESSION_CREATED: 'session.created',
  SESSION_UPDATED: 'session.updated',
  SESSION_DELETED: 'session.deleted',
} as const;

export class CLIWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private connected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelay = 1000;
  private readonly autoReconnect: boolean;
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  >();

  constructor(url: string, options?: { autoReconnect?: boolean; maxReconnectAttempts?: number }) {
    super();
    this.url = url;
    this.autoReconnect = options?.autoReconnect ?? true;
    this.maxReconnectAttempts = options?.maxReconnectAttempts ?? 3;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = (errorHandler: (err: Error) => void) => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        this.removeListener(WebSocketEvent.ERROR, errorHandler);
      };

      const errorHandler = (err: Error) => {
        cleanup(errorHandler);
        reject(err);
      };

      try {
        this.on(WebSocketEvent.ERROR, errorHandler);
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          cleanup(errorHandler);
          this.connected = true;
          this.reconnectAttempts = 0;
          this.emit(WebSocketEvent.CONNECTED);
          resolve();
        });

        this.ws.on('message', (data: Buffer | string) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (err: Error) => {
          this.emit(WebSocketEvent.ERROR, err);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          this.connected = false;
          this.emit(WebSocketEvent.DISCONNECTED, code, reason.toString());

          if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            void this.attemptReconnect();
          }
        });

        timeoutId = setTimeout(() => {
          if (!this.connected) {
            cleanup(errorHandler);
            this.ws?.close();
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);
      } catch (err) {
        cleanup(errorHandler);
        reject(err);
      }
    });
  }

  private handleMessage(data: Buffer | string): void {
    const raw = typeof data === 'string' ? data : data.toString();

    try {
      const message = JSON.parse(raw) as GatewayMessage;
      this.emit(WebSocketEvent.MESSAGE, message);

      switch (message.type) {
        case 'response':
          this.handleResponse(message);
          break;
        case 'event':
          this.handleEvent(message);
          break;
        default:
          break;
      }
    } catch {
      this.emit('raw', raw);
    }
  }

  private handleResponse(message: ResponseMessage): void {
    this.emit(WebSocketEvent.RESPONSE, message);

    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(message.requestId);
    if (message.status === 'success') {
      pending.resolve(message.payload);
    } else {
      pending.reject(new Error(message.errorMessage || 'Request failed'));
    }
  }

  private handleEvent(message: EventMessage): void {
    this.emit(WebSocketEvent.EVENT, message);

    switch (message.event) {
      case 'chat.delta':
        this.emit(WebSocketEvent.CHAT_DELTA, message.payload as unknown as ChatDeltaPayload);
        break;
      case 'chat.reasoning_delta':
        this.emit(WebSocketEvent.CHAT_REASONING_DELTA, message.payload as unknown as ChatDeltaPayload);
        break;
      case 'chat.done':
        this.emit(WebSocketEvent.CHAT_DONE, message.payload as unknown as ChatDonePayload);
        break;
      case 'chat.error':
        this.emit(WebSocketEvent.CHAT_ERROR, message.payload);
        break;
      case 'chat.message_sent':
        this.emit(WebSocketEvent.CHAT_MESSAGE_SENT, message.payload);
        break;
      // 跨端会话同步：服务器推送的 session.* 事件
      case 'session.created':
        this.emit(WebSocketEvent.SESSION_CREATED, message.payload);
        break;
      case 'session.updated':
        this.emit(WebSocketEvent.SESSION_UPDATED, message.payload);
        break;
      case 'session.deleted':
        this.emit(WebSocketEvent.SESSION_DELETED, message.payload);
        break;
      default:
        break;
    }
  }

  private async attemptReconnect(): Promise<void> {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });
    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await this.connect();
    } catch {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        await this.attemptReconnect();
      } else {
        this.emit('reconnect_failed');
      }
    }
  }

  async sendRequest<T = unknown>(action: string, payload: Record<string, unknown>): Promise<T> {
    // 如果连接断开，先等待重连
    if (!this.isConnected()) {
      const connected = await this.waitForConnection(5000);
      if (!connected) {
        throw new Error('WebSocket is not connected');
      }
    }

    return new Promise((resolve, reject) => {
      if (!this.isConnected() || !this.ws) {
        reject(new Error('WebSocket is not connected'));
        return;
      }

      const requestId = randomUUID();
      const message: RequestMessage = {
        type: 'request',
        id: requestId,
        timestamp: new Date().toISOString(),
        action,
        payload,
      };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout: ${action}`));
      }, 60000);

      this.pendingRequests.set(requestId, {
        resolve: (value: unknown) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (reason?: unknown) => {
          clearTimeout(timeout);
          reject(reason);
        },
      });

      this.ws.send(JSON.stringify(message));
    });
  }

  send(data: unknown): void {
    if (!this.isConnected() || !this.ws) {
      throw new Error('WebSocket is not connected');
    }

    this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
  }

  async sendChatMessage(
    sessionId: string,
    content: string,
    options?: { model?: string; channelId?: string; stream?: boolean; userId?: string },
  ): Promise<unknown> {
    return this.sendRequest('chat.send', {
      sessionId,
      content,
      model: options?.model,
      channelId: options?.channelId || SHARED_CHANNEL_ID,
      stream: options?.stream ?? true,
      userId: options?.userId || SHARED_USER_ID,
    });
  }

  async getChatHistory(sessionId: string, options?: { offset?: number; limit?: number }): Promise<unknown> {
    return this.sendRequest('chat.history', {
      sessionId,
      offset: options?.offset ?? 0,
      limit: options?.limit ?? 20,
    });
  }

  async bindSession(
    sessionId: string,
    options?: { channelId?: string; userId?: string },
  ): Promise<unknown> {
    return this.sendRequest('session.bind', {
      sessionId,
      channelId: options?.channelId || SHARED_CHANNEL_ID,
      userId: options?.userId || SHARED_USER_ID,
    });
  }

  ping(): void {
    if (!this.isConnected() || !this.ws) {
      return;
    }

    this.ws.send(JSON.stringify({ type: 'ping', id: randomUUID(), timestamp: new Date().toISOString() }));
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * 等待 WebSocket 连接恢复
   * 当连接断开后，自动尝试重连，超时则返回 false
   * @param timeoutMs 超时时间（毫秒）
   * @returns 是否连接成功
   */
  async waitForConnection(timeoutMs = 5000): Promise<boolean> {
    if (this.isConnected()) return true;

    // 如果已在重连中，等待重连完成
    if (this.autoReconnect) {
      return new Promise((resolve) => {
        // 监听连接恢复事件
        const onConnected = () => {
          cleanup();
          resolve(true);
        };
        const onReconnectFailed = () => {
          cleanup();
          resolve(false);
        };
        const cleanup = () => {
          this.removeListener(WebSocketEvent.CONNECTED, onConnected);
          this.removeListener('reconnect_failed', onReconnectFailed);
          clearTimeout(timeoutId);
        };

        this.on(WebSocketEvent.CONNECTED, onConnected);
        this.on('reconnect_failed', onReconnectFailed);

        // 如果还没开始重连，触发重连
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.reconnectAttempts = 0;
          void this.attemptReconnect();
        }

        const timeoutId = setTimeout(() => {
          cleanup();
          resolve(this.isConnected());
        }, timeoutMs);
      });
    }

    return false;
  }

  close(): void {
    for (const [, { reject }] of this.pendingRequests) {
      reject(new Error('WebSocket connection closed'));
    }
    this.pendingRequests.clear();

    if (this.ws && this.connected) {
      this.ws.close(1000, 'CLI chat finished');
    }

    this.ws = null;
    this.connected = false;
  }
}
