export interface GatewayConfig {
  wsUrl: string;
  httpUrl: string;
}

/**
 * MyOpenClaw WebSocket 通信客户端封装
 *
 * Gateway 使用 Fastify 单端口架构（默认 18780），
 * WebSocket 通过 /ws 路径接入，HTTP API 通过 /api/* 路径接入。
 */
export class MyOpenClawWebSocketClient {
  private ws: WebSocket | null = null;
  private config: GatewayConfig;
  private listeners = new Map<string, (data: unknown) => void>();

  constructor(config?: Partial<GatewayConfig>) {
    this.config = {
      wsUrl: config?.wsUrl ?? 'ws://127.0.0.1:18780/ws',
      httpUrl: config?.httpUrl ?? 'http://127.0.0.1:18780',
    };
  }

  connect(token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = token
        ? `${this.config.wsUrl}?token=${token}`
        : this.config.wsUrl;
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('WebSocket 连接失败'));
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const handler = this.listeners.get(msg.type);
        handler?.(msg);
      };
    });
  }

  send(method: string, params: object): void {
    this.ws?.send(
      JSON.stringify({
        type: 'request',
        id: crypto.randomUUID(),
        method,
        params,
      }),
    );
  }

  on(event: string, handler: (data: unknown) => void): void {
    this.listeners.set(event, handler);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
