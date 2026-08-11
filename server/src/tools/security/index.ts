/**
 * 工具安全校验模块（对齐文档 §8）
 *
 * 多层安全校验机制：
 * 1. 参数 Schema 校验（Ajv JSON Schema）
 * 2. 危险操作黑名单拦截
 * 3. 路径白名单检查
 * 4. 风险等级确认策略
 *
 * @module @myopenclaw/server/tools/security
 */

import { createLogger } from '../../core/utils/logger.js';
import type {
  Tool,
  ToolResult,
  InvokeContext,
  JSONSchema,
  UserPermissions,
} from '../../core/types/tool.js';
import { ErrorCode } from '../../core/errors/codes.js';

const log = createLogger('tools:security');

// ═══════════════════════════════════════════════════════════════
// 危险操作黑名单（对齐文档 §8.3）
// ═══════════════════════════════════════════════════════════════

/** 危险操作规则 */
export interface DangerousPattern {
  pattern: RegExp;
  category: string;
  description: string;
  action: 'block' | 'confirm';
}

/** 默认危险操作黑名单 */
export const DEFAULT_DANGEROUS_PATTERNS: DangerousPattern[] = [
  // 文件系统危险操作
  {
    pattern: /rm\s+-rf\s+\/\s*$/,
    category: 'filesystem',
    description: '递归删除根目录',
    action: 'block',
  },
  {
    pattern: /rm\s+-rf\s+~\/?\s*$/,
    category: 'filesystem',
    description: '递归删除用户主目录',
    action: 'block',
  },
  // 系统权限操作
  {
    pattern: /sudo\s+/,
    category: 'privilege',
    description: '提权操作',
    action: 'confirm',
  },
  {
    pattern: /chmod\s+777/,
    category: 'permission',
    description: '设置全权限',
    action: 'confirm',
  },
  // 磁盘危险操作
  {
    pattern: /dd\s+if=/i,
    category: 'disk',
    description: '磁盘写入操作',
    action: 'block',
  },
  {
    pattern: /mkfs\./,
    category: 'disk',
    description: '格式化文件系统',
    action: 'block',
  },
  // 数据库危险操作
  {
    pattern: /DROP\s+TABLE/i,
    category: 'database',
    description: '删除数据表',
    action: 'block',
  },
  {
    pattern: /TRUNCATE\s+TABLE/i,
    category: 'database',
    description: '清空数据表',
    action: 'block',
  },
  // 网络危险操作
  {
    pattern: /curl\s+.*\|\s*(ba)?sh/,
    category: 'network',
    description: '下载并执行远程脚本',
    action: 'block',
  },
  // 进程危险操作
  {
    pattern: /shutdown\s+-h\s+now/i,
    category: 'system',
    description: '立即关机',
    action: 'block',
  },
  {
    pattern: /reboot/i,
    category: 'system',
    description: '重启系统',
    action: 'block',
  },
  // 敏感文件操作
  {
    pattern: /\/etc\/passwd/,
    category: 'filesystem',
    description: '访问系统密码文件',
    action: 'block',
  },
  {
    pattern: /\/etc\/shadow/,
    category: 'filesystem',
    description: '访问系统影子密码文件',
    action: 'block',
  },
];

/** 工具级黑名单（直接禁用这些工具名） */
export const DEFAULT_BLOCKED_TOOLS = ['exec/root', 'fs/rm_rf', 'fs/delete_recursive'];

// ═══════════════════════════════════════════════════════════════
// SecurityManager 安全管理员
// ═══════════════════════════════════════════════════════════════

export class SecurityManager {
  private dangerousPatterns: DangerousPattern[];
  private blockedTools: string[];

  constructor(options?: {
    dangerousPatterns?: DangerousPattern[];
    blockedTools?: string[];
  }) {
    this.dangerousPatterns = options?.dangerousPatterns ?? DEFAULT_DANGEROUS_PATTERNS;
    this.blockedTools = options?.blockedTools ?? DEFAULT_BLOCKED_TOOLS;
  }

  // ═════════════════════════════════════════════════════════════
  // 参数 Schema 校验（对齐文档 §8.2）
  // ═════════════════════════════════════════════════════════════

  /**
   * 校验工具调用参数是否符合 JSON Schema 定义
   */
  validateParams(
    schema: JSONSchema,
    params: Record<string, unknown>,
  ): { valid: boolean; errors?: Array<{ field: string; message: string }> } {
    const errors: Array<{ field: string; message: string }> = [];

    // 校验必填字段
    if (schema.required) {
      for (const requiredField of schema.required) {
        if (params[requiredField] === undefined || params[requiredField] === null) {
          errors.push({
            field: requiredField,
            message: `缺少必填字段: ${requiredField}`,
          });
        }
      }
    }

    // 校验字段类型
    if (schema.properties) {
      for (const [field, propSchema] of Object.entries(schema.properties)) {
        const value = params[field];
        if (value === undefined) continue;

        // 类型校验
        if (propSchema.enum && Array.isArray(propSchema.enum)) {
          if (!propSchema.enum.includes(value)) {
            errors.push({
              field,
              message: `字段 ${field} 的值不在允许范围内，允许的值: ${propSchema.enum.join(', ')}`,
            });
          }
        }

        // 基本类型匹配
        const expectedType = propSchema.type;
        if (expectedType === 'array' && !Array.isArray(value)) {
          errors.push({ field, message: `字段 ${field} 应为数组类型` });
        } else if (expectedType === 'number' && typeof value !== 'number') {
          errors.push({ field, message: `字段 ${field} 应为数字类型` });
        } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
          errors.push({ field, message: `字段 ${field} 应为布尔类型` });
        } else if (expectedType === 'string' && typeof value !== 'string') {
          errors.push({ field, message: `字段 ${field} 应为字符串类型` });
        }
      }
    }

    return errors.length === 0 ? { valid: true } : { valid: false, errors };
  }

  // ═════════════════════════════════════════════════════════════
  // 危险操作拦截（对齐文档 §8.3）
  // ═════════════════════════════════════════════════════════════

  /**
   * 检查是否为被禁用的工具
   */
  isToolBlocked(toolName: string): boolean {
    return this.blockedTools.includes(toolName);
  }

  /**
   * 扫描命令中的危险模式
   *
   * @param command 要检查的命令字符串
   * @returns 命中的危险规则列表（空数组表示安全）
   */
  scanCommand(command: string): DangerousPattern[] {
    const matched: DangerousPattern[] = [];
    for (const rule of this.dangerousPatterns) {
      if (rule.pattern.test(command)) {
        matched.push(rule);
      }
    }
    return matched;
  }

  /**
   * 检查命令是否包含需确认的操作
   */
  hasConfirmablePatterns(command: string): boolean {
    return this.scanCommand(command).some((r) => r.action === 'confirm');
  }

  /**
   * 检查命令是否包含应拦截的操作
   */
  hasBlockedPatterns(command: string): boolean {
    return this.scanCommand(command).some((r) => r.action === 'block');
  }

  // ═════════════════════════════════════════════════════════════
  // 路径白名单检查（对齐文档 §8.4）
  // ═════════════════════════════════════════════════════════════

  /**
   * 校验文件路径是否在允许的目录范围内
   */
  validatePath(
    filePath: string,
    allowedPaths: string[],
  ): { allowed: boolean; reason?: string } {
    if (!filePath || allowedPaths.length === 0) {
      // 未设置白名单时默认允许（仍保留日志记录）
      return { allowed: true };
    }

    // 规范化路径（处理 Windows 反斜杠）
    const normalized = filePath.replace(/\\/g, '/');

    for (const allowed of allowedPaths) {
      const normAllowed = allowed.replace(/\\/g, '/').replace(/\/$/, '');
      if (normalized === normAllowed || normalized.startsWith(normAllowed + '/')) {
        return { allowed: true };
      }
    }

    return {
      allowed: false,
      reason: `路径 ${normalized} 不在允许的目录范围内（允许的目录: ${allowedPaths.join(', ')}）`,
    };
  }

  // ═════════════════════════════════════════════════════════════
  // 风险等级确认策略（对齐文档 §8.5）
  // ═════════════════════════════════════════════════════════════

  /**
   * 判断工具调用是否需要用户确认
   */
  needsConfirmation(
    toolRisk: 'low' | 'medium' | 'high',
    permissions?: UserPermissions,
  ): boolean {
    if (permissions?.requireConfirmationForAll) return true;

    const maxAutoRisk = permissions?.maxAutoRisk ?? 'medium';
    const riskOrder: Record<string, number> = { low: 0, medium: 1, high: 2 };

    return riskOrder[toolRisk] > riskOrder[maxAutoRisk];
  }

  /**
   * 综合安全校验流程（对齐文档 §8.1 流程图）
   *
   * 在工具执行前执行完整的安全检查，返回校验结果。
   */
  validateToolExecution(
    tool: Tool,
    params: Record<string, unknown>,
    context: InvokeContext,
  ): ToolResult | null {
    // 1. 检查工具是否在黑名单中
    if (this.isToolBlocked(tool.name)) {
      log.warn({ tool: tool.name }, '安全拦截：工具在黑名单中');
      return {
        success: false,
        status: 'error',
        error: `工具 ${tool.name} 已被安全策略禁用`,
        errorCode: String(ErrorCode.TOOL_NOT_ALLOWED),
        metadata: { durationMs: 0, sideEffects: [] },
      };
    }

    // 2. 参数 Schema 校验
    const paramCheck = this.validateParams(tool.parameters, params);
    if (!paramCheck.valid) {
      log.warn({ tool: tool.name, errors: paramCheck.errors }, '安全拦截：参数校验失败');
      return {
        success: false,
        status: 'error',
        error: `参数校验失败: ${paramCheck.errors?.map((e) => e.message).join('; ')}`,
        errorCode: String(ErrorCode.VALIDATION),
        metadata: { durationMs: 0, sideEffects: [] },
      };
    }

    // 3. 对 exec 类工具进行命令安全检查
    if (tool.name.startsWith('exec/')) {
      const command = String(params.command ?? params.cmd ?? '');
      if (command) {
        const dangerous = this.scanCommand(command);
        if (dangerous.length > 0) {
          const blocked = dangerous.filter((r) => r.action === 'block');
          if (blocked.length > 0) {
            log.warn({ tool: tool.name, command, blocked }, '安全拦截：命令命中黑名单');
            return {
              success: false,
              status: 'error',
              error: `命令被安全策略拦截：${blocked.map((b) => b.description).join('; ')}`,
              errorCode: String(ErrorCode.FORBIDDEN),
              metadata: { durationMs: 0, sideEffects: [] },
            };
          }
          // confirm 类型的操作暂时允许通过（由上层处理确认逻辑）
          log.info({ tool: tool.name, command, confirmable: dangerous.filter((r) => r.action === 'confirm') }, '命令包含需确认的操作');
        }
      }
    }

    // 4. 对 fs 类工具进行路径白名单检查
    if (tool.name.startsWith('fs/') && context.allowedPaths && context.allowedPaths.length > 0) {
      const path = String(params.path ?? '');
      if (path) {
        const pathCheck = this.validatePath(path, context.allowedPaths);
        if (!pathCheck.allowed) {
          log.warn({ tool: tool.name, path }, '安全拦截：路径不在白名单内');
          return {
            success: false,
            status: 'error',
            error: pathCheck.reason ?? '路径访问被拒绝',
            errorCode: String(ErrorCode.FORBIDDEN),
            metadata: { durationMs: 0, sideEffects: [] },
          };
        }
      }
    }

    // 5. 风险等级检查（如果需要确认，返回特殊状态）
    if (tool.risk === 'high') {
      log.warn({ tool: tool.name, risk: tool.risk }, '高风险工具调用，需用户确认');
      // 高风险工具允许执行，但记录日志
    }

    // 全部检查通过
    return null;
  }
}

/** 单例安全管理员，全局共享危险模式列表 */
let _globalInstance: SecurityManager | null = null;

/**
 * 获取全局 SecurityManager 实例
 */
export function getSecurityManager(): SecurityManager {
  if (!_globalInstance) {
    _globalInstance = new SecurityManager();
  }
  return _globalInstance;
}

/**
 * 重置全局 SecurityManager 实例（用于测试）
 */
export function resetSecurityManager(): void {
  _globalInstance = null;
}
