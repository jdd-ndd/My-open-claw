/**
 * Gateway 服务器配置类型定义
 *
 * @module @myopenclaw/server/gateway/server
 */

/**
 * 网关服务器配置接口
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
}
