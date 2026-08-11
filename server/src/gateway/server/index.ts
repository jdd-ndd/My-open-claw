/**
 * Gateway 服务器子模块入口
 *
 * 将 GatewayServer 拆分为单一职责模块：
 * - types: 配置类型定义
 * - connection-store: WebSocket 连接与元数据存储
 * - messaging: 消息发送与广播
 * - http-routes: HTTP REST 路由注册
 * - websocket-handler: WebSocket 连接与消息处理
 * - heartbeat: 心跳保活
 * - middleware: 请求处理中间件链
 * - gateway-server: 主 GatewayServer 编排类
 *
 * @module @myopenclaw/server/gateway/server
 */

export { GatewayServer, type GatewayServerConfig } from './gateway-server.js';

export { ConnectionStore, type ConnectionMetadata } from './connection-store.js';

export { createMessenger, type Messenger, type BroadcastResult } from './messaging.js';

export { registerHttpRoutes, type ExtendedHttpRouteDeps } from './http-routes.js';

export { handleConnection, type WebSocketHandlerDeps } from './websocket-handler.js';

export { startHeartbeat, stopHeartbeat } from './heartbeat.js';

export {
  createAuthMiddleware,
  createOptionalAuthMiddleware,
  requireScope,
  createRateLimitMiddleware,
  createLoggingMiddleware,
  registerErrorHandler,
} from './middleware/index.js';

export type {
  GatewayServerConfig as GatewayServerConfigType,
  AuditConfig,
  SecuritySubConfig,
  SchedulerConfig,
} from './types.js';
