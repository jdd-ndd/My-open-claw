/**
 * SecuritySandbox —— 安全沙箱模块
 *
 * 提供鉴权、频率限制（令牌桶）、命令白名单校验、危险操作拦截、
 * 输入 Schema 校验等安全防护能力。
 *
 * @module @myopenclaw/server/gateway
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '../../core/utils/logger.js';
import type {
  DangerPattern,
  SecurityConfig,
  SecurityCheckResult,
  RateLimitState,
} from './types.js';

const log = createLogger('gateway:security');

export class SecuritySandbox extends EventEmitter {
  /** 频率限制状态映射（按 clientId） */
  private rateLimitStates = new Map<string, RateLimitState>();

  /** 默认危险操作拦截规则 */
  static readonly DEFAULT_DANGER_PATTERNS: DangerPattern[] = [
    {
      id: 'rm_rf',
      description: '禁止递归强制删除根目录',
      pattern: 'rm\\s+-rf\\s+/',
      action: 'block',
    },
    {
      id: 'drop_table',
      description: '禁止删除数据库表',
      pattern: 'DROP\\s+TABLE',
      action: 'block',
    },
    {
      id: 'drop_database',
      description: '禁止删除数据库',
      pattern: 'DROP\\s+DATABASE',
      action: 'block',
    },
    {
      id: 'shutdown',
      description: '禁止关闭系统',
      pattern: 'shutdown\\s+-h\\s+now',
      action: 'block',
    },
    {
      id: 'chmod_777',
      description: '警告设置全局可写权限',
      pattern: 'chmod\\s+777',
      action: 'warn',
    },
    {
      id: 'curl_pipe',
      description: '警告通过管道执行远程脚本',
      pattern: 'curl\\s+\\S+\\s*\\|\\s*(ba)?sh',
      action: 'warn',
    },
  ];

  private readonly config: SecurityConfig;

  /**
   * 创建安全沙箱实例
   * @param config - 安全配置
   */
  constructor(config: SecurityConfig) {
    super();
    this.config = config;
  }

  /**
   * 获取限流配置（供中间件读取）
   */
  getRateLimitConfig(): { rateLimit: number } {
    return { rateLimit: this.config.rateLimit };
  }

  // ==================== 鉴权 ====================

  /**
   * 校验请求 Token 的有效性
   * @param token - 请求中携带的 Token
   * @returns 校验结果
   */
  authenticate(token: string | undefined): SecurityCheckResult {
    // 未配置 apiToken 时跳过鉴权
    if (!this.config.apiToken) {
      return { passed: true };
    }

    // 未提供 Token
    if (!token) {
      return {
        passed: false,
        reason: '缺少鉴权 Token',
        ruleId: 'auth_missing',
      };
    }

    // 时序安全比较
    if (!this.safeCompare(token, this.config.apiToken)) {
      return {
        passed: false,
        reason: 'Token 无效',
        ruleId: 'auth_invalid',
      };
    }

    return { passed: true };
  }

  // ==================== 频率限制 ====================

  /**
   * 检查客户端频率限制（令牌桶算法）
   * @param clientId - 客户端唯一标识
   * @returns 校验结果
   */
  checkRateLimit(clientId: string): SecurityCheckResult {
    const now = Date.now();
    let state = this.rateLimitStates.get(clientId);

    // 创建或初始化令牌桶状态
    if (!state) {
      state = {
        clientId,
        tokens: this.config.rateLimit,
        lastRefillTime: now,
        capacity: this.config.rateLimit,
        refillRate: this.config.rateLimit / 60, // 按每分钟分配令牌补充速率
      };
      this.rateLimitStates.set(clientId, state);
    }

    // 根据经过的时间补充令牌
    const elapsed = (now - state.lastRefillTime) / 1000;
    const refillTokens = elapsed * state.refillRate;
    state.tokens = Math.min(state.capacity, state.tokens + refillTokens);
    state.lastRefillTime = now;

    // 消耗一个令牌
    if (state.tokens < 1) {
      return {
        passed: false,
        reason: '请求频率超限，请稍后重试',
        ruleId: 'rate_limit_exceeded',
      };
    }

    state.tokens -= 1;
    return { passed: true };
  }

  // ==================== 命令安全检查 ====================

  /**
   * 检查命令是否安全可执行
   * @param command - 要执行的命令字符串
   * @returns 校验结果
   */
  checkCommand(command: string): SecurityCheckResult {
    // 沙箱禁用时直接放行
    if (!this.config.sandboxEnabled) {
      return { passed: true };
    }

    // 提取命令的第一个词作为命令名
    const cmdName = command.trim().split(/\s+/)[0] ?? '';

    // 检查是否在白名单中
    if (this.config.allowedCommands.length > 0) {
      const allowed = this.config.allowedCommands.some(
        (allowedCmd) => allowedCmd === cmdName,
      );
      if (!allowed) {
        return {
          passed: false,
          reason: `命令 "${cmdName}" 不在白名单中`,
          ruleId: 'cmd_not_allowed',
        };
      }
    }

    // 检查危险内容
    return this.checkDangerousContent(command);
  }

  // ==================== 危险内容检测 ====================

  /**
   * 检测内容中是否包含危险操作
   * @param content - 待检测内容
   * @returns 校验结果（block 规则匹配时返回失败，warn 规则只收集警告）
   */
  checkDangerousContent(content: string): SecurityCheckResult {
    const dangerPatterns = this.config.dangerPatterns.length > 0
      ? this.config.dangerPatterns
      : SecuritySandbox.DEFAULT_DANGER_PATTERNS;

    const warnings: string[] = [];

    for (const rule of dangerPatterns) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(content)) {
          if (rule.action === 'block') {
            log.warn({ ruleId: rule.id, content }, '危险操作已被拦截');
            return {
              passed: false,
              reason: rule.description,
              ruleId: rule.id,
            };
          }
          if (rule.action === 'warn') {
            warnings.push(rule.description);
          }
        }
      } catch {
        log.warn({ ruleId: rule.id }, '危险模式正则表达式无效，已跳过');
      }
    }

    if (warnings.length > 0) {
      return { passed: true, warnings };
    }

    return { passed: true };
  }

  // ==================== Schema 校验 ====================

  /**
   * 校验输入数据是否符合指定的 Schema 结构
   * @param input - 待校验的输入数据
   * @param schema - 校验规则（支持 type、required、properties）
   * @returns 校验结果
   */
  validateSchema(
    input: unknown,
    schema: {
      type?: string;
      required?: string[];
      properties?: Record<string, { type: string }>;
    },
  ): SecurityCheckResult {
    // 类型检查
    if (schema.type) {
      const actualType = Array.isArray(input)
        ? 'array'
        : input === null
          ? 'null'
          : typeof input;
      if (actualType !== schema.type) {
        return {
          passed: false,
          reason: `期望类型为 "${schema.type}"，实际为 "${actualType}"`,
          ruleId: 'schema_type_mismatch',
        };
      }
    }

    // required 字段检查
    if (schema.required && typeof input === 'object' && input !== null) {
      const obj = input as Record<string, unknown>;
      for (const key of schema.required) {
        if (!(key in obj) || obj[key] === undefined) {
          return {
            passed: false,
            reason: `缺少必填字段 "${key}"`,
            ruleId: 'schema_missing_required',
          };
        }
      }
    }

    // properties 类型检查
    if (schema.properties && typeof input === 'object' && input !== null) {
      const obj = input as Record<string, unknown>;
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj && obj[key] !== undefined) {
          const actualType = Array.isArray(obj[key])
            ? 'array'
            : obj[key] === null
              ? 'null'
              : typeof obj[key];
          if (actualType !== propSchema.type) {
            return {
              passed: false,
              reason: `字段 "${key}" 期望类型为 "${propSchema.type}"，实际为 "${actualType}"`,
              ruleId: 'schema_property_type_mismatch',
            };
          }
        }
      }
    }

    return { passed: true };
  }

  // ==================== 内部工具 ====================

  /**
   * 时序安全的字符串比较（防时序攻击）
   * 使用 XOR 逐字节比较，无论是否匹配消耗相同时间
   * @param a - 待比较字符串 A
   * @param b - 待比较字符串 B
   * @returns 是否相等
   */
  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);

    if (bufA.length !== bufB.length) {
      // 依然进行完整比较以防止长度泄露时序信息
      let result = bufA.length ^ bufB.length;
      for (let i = 0; i < Math.min(bufA.length, bufB.length); i++) {
        result |= bufA[i] ^ bufB[i];
      }
      return result === 0;
    }

    // 长度相同的 XOR 逐字节比较
    let result = 0;
    for (let i = 0; i < bufA.length; i++) {
      result |= bufA[i] ^ bufB[i];
    }
    return result === 0;
  }
}
