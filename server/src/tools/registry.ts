/**
 * ToolRegistry —— 工具注册中心（完整实现版 v1.0.2）
 *
 * 对齐文档：docs/06-Tools工具与技能模块.md §3
 *
 * 统一管理所有底层可执行工具，LLM 只能通过注册中心发起调用。
 * 支持运行时动态注册与卸载工具、参数校验、安全检查、并行批量调用。
 *
 * @module @myopenclaw/server/tools
 */

import { createLogger } from '../core/utils/logger.js';
import { ErrorCode, AppError } from '../core/errors/index.js';
import type { SecurityManager} from './security/index.js';
import { getSecurityManager } from './security/index.js';
import type {
  Tool,
  ToolResult,
  InvokeContext,
  RegisterOptions,
  ToolFilter,
  ToolDescriptor,
  ToolCall,
  RegistryChangeEvent,
} from '../core/types/index.js';

const log = createLogger('tools:registry');

/** Registry 变更事件监听器 */
type ChangeListener = (event: RegistryChangeEvent) => void;

/** 内部注册项（包含原 Tool + 元信息） */
interface RegistryEntry {
  tool: Tool;
  builtin: boolean;
  registeredAt: number;
}

/**
 * ToolRegistry —— 工具注册中心
 *
 * 统一管理所有工具的注册、注销、查询和调用。
 * Agent 和 LLM 只能通过 Registry 调用工具，不能直接访问工具实例。
 */
export class ToolRegistry {
  private tools = new Map<string, RegistryEntry>();
  private listeners = new Set<ChangeListener>();
  private security: SecurityManager;

  constructor(options?: { security?: SecurityManager }) {
    this.security = options?.security ?? getSecurityManager();
  }

  // ═════════════════════════════════════════════════════════════
  // 注册接口（对齐文档 §3.1）
  // ═════════════════════════════════════════════════════════════

  /**
   * 注册一个工具
   *
   * 将工具实例注册到注册中心，注册后即可被 Agent 调用。
   * 如果同名工具已存在，默认抛出错误（可通过 options.force 覆盖）。
   *
   * @param tool 工具实例
   * @param options 注册选项
   * @returns 注册成功返回 true
   */
  async register(tool: Tool, options?: RegisterOptions): Promise<boolean> {
    const existing = this.tools.get(tool.name);

    if (existing) {
      if (options?.force) {
        log.info({ tool: tool.name }, '同名工具已存在，force 模式覆盖');
      } else {
        throw new AppError({
          code: ErrorCode.INTERNAL,
          message: `工具 ${tool.name} 已注册，使用 force 模式可覆盖`,
          statusCode: 409,
        });
      }
    }

    this.tools.set(tool.name, {
      tool,
      builtin: options?.builtin ?? false,
      registeredAt: Date.now(),
    });

    // 通知监听器
    this.emitChange('register', tool.name);

    log.info({ tool: tool.name, builtin: options?.builtin }, '工具已注册');
    return true;
  }

  /**
   * 批量注册工具
   *
   * @param tools 工具实例列表
   * @param options 注册选项
   */
  async registerAll(tools: Tool[], options?: RegisterOptions): Promise<void> {
    for (const tool of tools) {
      await this.register(tool, options);
    }
  }

  /**
   * 注销一个工具
   *
   * 从注册中心移除指定工具。内置工具不可注销。
   *
   * @param name 工具名（如 fs/read_file）
   * @returns 注销成功返回 true，工具不存在或为内置返回 false
   */
  async unregister(name: string): Promise<boolean> {
    const entry = this.tools.get(name);
    if (!entry) {
      log.warn({ tool: name }, '尝试注销不存在的工具');
      return false;
    }

    if (entry.builtin) {
      log.warn({ tool: name }, '内置工具不可注销');
      return false;
    }

    this.tools.delete(name);

    // 通知监听器
    this.emitChange('unregister', name);

    log.info({ tool: name }, '工具已注销');
    return true;
  }

  // ═════════════════════════════════════════════════════════════
  // 查询接口
  // ═════════════════════════════════════════════════════════════

  /**
   * 查询工具是否存在
   *
   * @param name 工具名
   * @returns 存在返回 true
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取工具实例
   *
   * @param name 工具名
   * @returns 工具实例，不存在返回 undefined
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name)?.tool;
  }

  /**
   * 获取工具描述符
   *
   * 返回工具的元信息（名称、描述、参数 Schema），用于注入 LLM。
   *
   * @param name 工具名
   * @returns 工具描述符
   */
  getDescriptor(name: string): ToolDescriptor | undefined {
    const entry = this.tools.get(name);
    if (!entry) return undefined;

    return {
      name: entry.tool.name,
      description: entry.tool.description,
      parameters: entry.tool.parameters,
      risk: entry.tool.risk,
      builtin: entry.builtin,
      category: entry.tool.category,
    };
  }

  /**
   * 列出所有已注册工具
   *
   * @param filter 可选的过滤条件（按命名空间、风险等级等）
   * @returns 工具列表
   */
  listAll(filter?: ToolFilter): Tool[] {
    let entries = Array.from(this.tools.values());

    if (filter) {
      // 按命名空间过滤
      if (filter.namespace) {
        entries = entries.filter((e) => e.tool.name.startsWith(filter.namespace! + '/'));
      }
      // 按分类过滤
      if (filter.category) {
        entries = entries.filter((e) => e.tool.category === filter.category);
      }
      // 按风险等级过滤
      if (filter.risk) {
        entries = entries.filter((e) => e.tool.risk === filter.risk);
      }
      // 只返回内置工具
      if (filter.builtinOnly) {
        entries = entries.filter((e) => e.builtin);
      }
    }

    return entries.map((e) => e.tool);
  }

  /**
   * 列出所有已注册工具的描述符
   *
   * @param filter 可选的过滤条件
   * @returns 工具描述符列表
   */
  list(filter?: ToolFilter): ToolDescriptor[] {
    let entries = Array.from(this.tools.values());

    if (filter) {
      if (filter.namespace) {
        entries = entries.filter((e) => e.tool.name.startsWith(filter.namespace! + '/'));
      }
      if (filter.category) {
        entries = entries.filter((e) => e.tool.category === filter.category);
      }
      if (filter.risk) {
        entries = entries.filter((e) => e.tool.risk === filter.risk);
      }
      if (filter.builtinOnly) {
        entries = entries.filter((e) => e.builtin);
      }
    }

    return entries.map((e) => ({
      name: e.tool.name,
      description: e.tool.description,
      parameters: e.tool.parameters,
      risk: e.tool.risk,
      builtin: e.builtin,
      category: e.tool.category,
    }));
  }

  // ═════════════════════════════════════════════════════════════
  // 执行接口（对齐文档 §3.1）
  // ═════════════════════════════════════════════════════════════

  /**
   * 调用工具
   *
   * 这是 Agent 调用工具的唯一入口。
   * 内部会执行参数校验、安全检查、调用执行、结果包装的完整流程。
   *
   * @param name 工具名
   * @param params 调用参数
   * @param context 调用上下文（会话 ID、用户权限等）
   * @returns 工具执行结果
   */
  async invoke(
    name: string,
    params: Record<string, unknown>,
    context: InvokeContext,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    // 查找工具
    const entry = this.tools.get(name);
    if (!entry) {
      return {
        success: false,
        status: 'error',
        error: `工具 ${name} 未注册`,
        errorCode: String(ErrorCode.TOOL_NOT_FOUND),
        metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
      };
    }

    const tool = entry.tool;

    // 安全校验（对齐文档 §8.1 流程图）
    const securityResult = this.security.validateToolExecution(tool, params, context);
    if (securityResult) {
      securityResult.metadata = {
        ...securityResult.metadata,
        durationMs: Date.now() - startTime,
      };
      return securityResult;
    }

    // 设置超时
    const timeoutMs = context.timeoutMs ?? 60000;
    const timeoutPromise = new Promise<ToolResult>((_, reject) => {
      setTimeout(() => {
        reject(new AppError({
          code: ErrorCode.TOOL_TIMEOUT,
          message: `工具 ${name} 执行超时（${timeoutMs}ms）`,
          statusCode: 504,
          retryable: true,
        }));
      }, timeoutMs);
    });

    try {
      // 执行工具（带超时控制）
      const result = await Promise.race([
        tool.execute(params, context),
        timeoutPromise,
      ]);

      // 补充元信息
      result.metadata = {
        durationMs: Date.now() - startTime,
        sideEffects: [],
        ...(result.metadata ?? {}),
      };

      // 补充 status
      if (!result.status) {
        result.status = result.success ? 'success' : 'error';
      }

      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      log.error({ tool: name, err: (err as Error).message }, '工具执行失败');

      if (err instanceof AppError) {
        return {
          success: false,
          status: err.code === ErrorCode.TOOL_TIMEOUT ? 'timeout' : 'error',
          error: err.message,
          errorCode: String(err.code),
          metadata: { durationMs, sideEffects: [] },
        };
      }

      return {
        success: false,
        status: 'error',
        error: `工具执行失败: ${(err as Error).message}`,
        errorCode: String(ErrorCode.TOOL_EXECUTION_FAILED),
        metadata: { durationMs, sideEffects: [] },
      };
    }
  }

  /**
   * 批量调用工具（并行）
   *
   * 同时调用多个无依赖的工具，提升执行效率。
   *
   * @param calls 工具调用列表
   * @param context 调用上下文
   * @returns 每个工具的执行结果（按调用顺序排列）
   */
  async invokeBatch(
    calls: ToolCall[],
    context: InvokeContext,
  ): Promise<ToolResult[]> {
    if (calls.length === 0) return [];

    log.info({ count: calls.length }, '开始批量并行调用工具');
    const startTime = Date.now();

    const results = await Promise.all(
      calls.map((call) => this.invoke(call.name, call.params, context)),
    );

    const successCount = results.filter((r) => r.success).length;
    log.info(
      { total: calls.length, success: successCount, failed: calls.length - successCount, durationMs: Date.now() - startTime },
      '批量工具调用完成',
    );

    return results;
  }

  /**
   * 执行单个工具（兼容旧接口，内部调用 invoke）
   *
   * @deprecated 请使用 invoke 替代
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    ctx: { sessionId: string; userId: string; channelId: string; config: Record<string, unknown> },
  ): Promise<ToolResult> {
    return this.invoke(toolName, args, {
      sessionId: ctx.sessionId,
      userId: ctx.userId,
      channelId: ctx.channelId,
      config: ctx.config,
    });
  }

  // ═════════════════════════════════════════════════════════════
  // 事件监听（对齐文档 §3.1）
  // ═════════════════════════════════════════════════════════════

  /**
   * 注册状态变更监听器
   *
   * @param listener 监听器函数
   * @returns 取消监听的函数
   */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 触发变更事件通知所有监听器 */
  private emitChange(type: 'register' | 'unregister', toolName: string): void {
    const event: RegistryChangeEvent = { type, toolName, timestamp: Date.now() };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'Registry 变更监听器执行失败');
      }
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 工具方法
  // ═════════════════════════════════════════════════════════════

  /**
   * 获取已注册的工具数量
   */
  get count(): number {
    return this.tools.size;
  }

  /**
   * 获取工具分类统计
   */
  getCategoryStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const entry of this.tools.values()) {
      const cat = entry.tool.category;
      stats[cat] = (stats[cat] ?? 0) + 1;
    }
    return stats;
  }

  /**
   * 清空所有工具（仅非内置工具）
   */
  clearNonBuiltin(): void {
    const toRemove: string[] = [];
    for (const [name, entry] of this.tools) {
      if (!entry.builtin) {
        toRemove.push(name);
      }
    }
    for (const name of toRemove) {
      this.tools.delete(name);
      this.emitChange('unregister', name);
    }
    if (toRemove.length > 0) {
      log.info({ count: toRemove.length }, '已清理非内置工具');
    }
  }
}
