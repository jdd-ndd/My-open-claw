/**
 * 记忆检索工具
 */
import { createLogger } from '../../core/utils/logger.js';
import type { Tool } from '../registry.js';
import type { ToolContext, ToolResult } from '../../core/types/index.js';

const log = createLogger('tools:memory_search');

export class MemorySearchTool implements Tool {
  readonly name = 'memory_search';
  readonly description = '语义检索长期向量记忆';
  readonly category = 'memory';
  readonly inputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索查询' },
      topK: { type: 'number', description: '返回条数', default: 5 },
    },
    required: ['query'],
  };

  async execute(
    args: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    log.info({ query: args.query }, '记忆检索工具调用');
    return { success: true, status: 'success', result: { message: '占位实现' } };
  }
}
