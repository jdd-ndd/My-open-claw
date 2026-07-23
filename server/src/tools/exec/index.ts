/**
 * Shell 命令执行工具
 */
import { createLogger } from '../../core/utils/logger.js';
import type { Tool } from '../registry.js';
import type { ToolContext, ToolResult } from '../../core/types/index.js';

const log = createLogger('tools:exec');

export class ExecTool implements Tool {
  readonly name = 'exec';
  readonly description = '执行 Shell 命令（沙箱化安全执行）';
  readonly category = 'system';
  readonly inputSchema = {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的 Shell 命令' },
      cwd: { type: 'string', description: '工作目录' },
      timeout: { type: 'number', description: '超时时间（毫秒）', default: 30_000 },
    },
    required: ['command'],
  };

  async execute(
    args: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    log.info({ command: args.command }, 'Shell 执行工具调用');
    return { success: true, status: 'success', result: { message: '占位实现' } };
  }
}
