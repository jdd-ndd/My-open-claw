/**
 * TUI 默认配置
 * 端口等可通过环境变量覆盖
 */

export interface TUIConfig {
  /** Gateway WebSocket 地址 */
  gatewayUrl: string;
  /** HTTP 备用地址(用于健康检查) */
  httpUrl: string;
  /** 默认会话 ID */
  defaultSessionId: string;
  /** 当前用户 ID(可由 server 端 hello 消息覆盖) */
  userId: string;
  /** 本地 mock 模式(无 server 时降级) */
  mockMode: boolean;
}

const env = process.env;

export const defaultConfig: TUIConfig = {
  gatewayUrl: env.TUI_GATEWAY_URL ?? 'ws://localhost:18780/ws',
  httpUrl: env.TUI_HTTP_URL ?? 'http://localhost:18780',
  defaultSessionId: env.TUI_SESSION_ID ?? 'session-local',
  userId: env.TUI_USER_ID ?? 'tui-user',
  mockMode: (env.TUI_MOCK ?? 'false') === 'true',
};
