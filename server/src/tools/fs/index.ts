/**
 * 文件操作工具
 */
import { createLogger } from '../../core/utils/logger.js';
import type { Tool } from '../registry.js';
import type { ToolContext, ToolResult } from '../../core/types/index.js';

const log = createLogger('tools:fs');

export class FsTool implements Tool {
  readonly name = 'fs';
  readonly description = '文件系统操作（读取、写入、列出目录等）';
  readonly category = 'io';
  readonly inputSchema = {
    type: 'object',
    properties: {
      operation: { type: 'string', description: '操作: read | write | list | delete' },
      path: { type: 'string', description: '文件/目录路径' },
      content: { type: 'string', description: '写入内容（write 操作时使用）' },
    },
    required: ['operation', 'path'],
  };

  async execute(
    args: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    log.info({ op: args.operation, path: args.path }, '文件操作工具调用');
    return { success: true, status: 'success', result: { message: '占位实现' } };
  }
}
