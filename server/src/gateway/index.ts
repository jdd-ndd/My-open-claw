/**
 * Gateway 网关系列入口
 *
 * @module @myopenclaw/server/gateway
 */

// 核心基础设施
export { MemoryStorage, type StorageRow } from './core/index.js';

// 网关服务器
export { GatewayServer, type GatewayServerConfig } from './server/index.js';

// 子功能模块
export { MessageRouter, type AgentConfig } from './routing/index.js';
export { SessionManager } from './sessions/index.js';
export { StateManager } from './state/index.js';
export { SecuritySandbox } from './security/index.js';
export { TokenService, TokenExpiredError, TokenInvalidError } from './security/token-service.js';
export { CircuitBreaker, CircuitState, CircuitOpenError } from './security/circuit-breaker.js';
export type { CircuitBreakerConfig, CircuitBreakerState } from './security/circuit-breaker.js';
export { TaskScheduler } from './scheduler/index.js';
export { AuditLogger } from './audit/index.js';
export { AgentBridge } from './agent-bridge.js';
export type { AgentBridgeConfig, AgentRuntime } from './agent-bridge.js';

// 中间件
export {
  createAuthMiddleware,
  createOptionalAuthMiddleware,
  requireScope,
  createRateLimitMiddleware,
  createLoggingMiddleware,
  registerErrorHandler,
} from './server/middleware/index.js';

// 类型（统一导出）
export type * from './types/index.js';
export type * from './routing/types.js';
export type * from './sessions/types.js';
export type * from './state/types.js';
export type * from './security/types.js';
export type * from './security/token-service.js';
export type * from './scheduler/types.js';
export type * from './audit/types.js';

// 向后兼容：值导出（MessageDirection 等）
export { MessageDirection } from './protocol.js';
