/**
 * 工具相关类型定义
 *
 * @module @myopenclaw/server/core/types
 */

/** 工具执行上下文 */
export interface ToolContext {
  sessionId: string;
  userId: string;
  channelId: string;
  config: Record<string, unknown>;
}

/** 工具执行结果 */
export interface ToolResult {
  success: boolean;
  status: 'success' | 'error' | 'timeout';
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** 工具接口 */
export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly inputSchema: Record<string, unknown>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
