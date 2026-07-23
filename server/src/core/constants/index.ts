/**
 * Core Constants — 聚合导出
 *
 * @module @myopenclaw/server/core/constants
 */

export { DEFAULT_GATEWAY_PORT, DEFAULT_HTTP_PORT, AGENT_PORT_RANGE } from './ports.js';
export {
  LLM_TIMEOUT_MS,
  TOOL_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
} from './timeouts.js';
export { EventType } from './events.js';
export type { EventTypeName } from './events.js';

/** 协议版本 */
export const PROTOCOL_VERSION = '1.0.0';

/** 框架名称 */
export const FRAMEWORK_NAME = 'MyOpenClaw';

/** 默认每页数量 */
export const DEFAULT_PAGE_SIZE = 20;

/** 最大每页数量 */
export const MAX_PAGE_SIZE = 100;
