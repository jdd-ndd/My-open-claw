/**
 * Gateway 服务器配置类型定义
 *
 * @module @myopenclaw/server/gateway/server
 */

import type { SecurityConfig } from '../security/types.js';

/** 审计日志子配置 */
export interface AuditConfig {
  /** 日志文件路径，默认 ./data/audit.jsonl */
  logFilePath: string;
}

/** 安全子配置 */
export interface SecuritySubConfig extends Partial<SecurityConfig> {
  /** API 签名密钥，用于 JWT Token 签发 */
  secret?: string;
  /** Token 默认过期天数 */
  tokenExpiryDays?: number;
}

/** 调度器子配置 */
export interface SchedulerConfig {
  /** 是否在启动时加载已持久化的 Cron 任务 */
  loadSavedTasks: boolean;
}

/**
 * 网关服务器完整配置接口
 */
export interface GatewayServerConfig {
  /** 监听主机地址 */
  host: string;
  /** WebSocket / HTTP 共用监听端口 */
  port: number;
  /** 心跳间隔（毫秒），默认 30000 */
  heartbeatInterval: number;
  /** WebSocket 最大连接数，默认 1000 */
  maxConnections: number;
  /** HTTP 请求超时（毫秒），默认 30000 */
  requestTimeout: number;
  /** 安全配置（可选，使用默认值） */
  security?: SecuritySubConfig;
  /** 审计日志配置（可选） */
  audit?: AuditConfig;
  /** 调度器配置（可选） */
  scheduler?: SchedulerConfig;
  /** 网关版本号 */
  version?: string;
}
