/**
 * Security 模块类型定义
 *
 * @module @myopenclaw/server/gateway
 */

/** 危险操作匹配模式 */
export interface DangerPattern {
  /** 规则唯一标识 */
  id: string;
  /** 规则描述 */
  description: string;
  /** 正则表达式模式 */
  pattern: string;
  /** 匹配后的处理动作 */
  action: 'block' | 'warn';
}

/** 安全模块配置 */
export interface SecurityConfig {
  /** API 鉴权 Token */
  apiToken: string;
  /** 频率限制（每时间窗口内允许的请求数） */
  rateLimit: number;
  /** 是否启用沙箱模式（仅允许白名单命令） */
  sandboxEnabled: boolean;
  /** 允许执行的命令白名单 */
  allowedCommands: string[];
  /** 危险操作拦截规则列表 */
  dangerPatterns: DangerPattern[];
}

/** 安全检查结果 */
export interface SecurityCheckResult {
  /** 是否通过检查 */
  passed: boolean;
  /** 未通过原因 */
  reason?: string;
  /** 触发的规则 ID */
  ruleId?: string;
  /** 收集到的警告信息列表 */
  warnings?: string[];
}

/** 频率限制状态（令牌桶） */
export interface RateLimitState {
  /** 客户端唯一标识 */
  clientId: string;
  /** 当前可用令牌数 */
  tokens: number;
  /** 上次补充令牌的时间戳（毫秒） */
  lastRefillTime: number;
  /** 令牌桶容量 */
  capacity: number;
  /** 令牌补充速率（个/秒） */
  refillRate: number;
}
