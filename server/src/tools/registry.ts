/**
 * ToolRegistry —— 工具注册中心
 *
 * 统一管理所有底层可执行工具，LLM 只能通过注册中心发起调用。
 * 支持运行时动态注册与卸载工具。
 *
 * @module @myopenclaw/server/tools
 */

import { createLogger } from '../core/utils/logger.js';
import { ErrorCode, AppError } from '../core/errors/index.js';
import type { ToolContext, ToolResult } from '../core/types/index.js';

const log = createLogger('tools:registry');

/**
 * Tool 基类接口 —— 所有底层工具必须实现此接口
 */
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly inputSchema: Record<string, unknown>;

  /** 执行工具 */
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /** 注册工具 */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    log.info({ tool: tool.name }, '工具已注册');
  }

  /** 执行已注册的工具 */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new AppError({
        code: ErrorCode.TOOL_NOT_FOUND,
        message: `工具 ${toolName} 未注册`,
        statusCode: 404,
      });
    }
    return tool.execute(args, ctx);
  }

  /** 获取全部已注册工具列表（供 LLM function calling 使用） */
  listAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** 卸载工具 */
  unregister(toolName: string): void {
    this.tools.delete(toolName);
    log.info({ tool: toolName }, '工具已卸载');
  }
}
