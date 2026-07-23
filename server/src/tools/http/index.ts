/**
 * HTTP 请求工具
 */
import { createLogger } from '../../core/utils/logger.js';
import type { Tool } from '../registry.js';
import type { ToolContext, ToolResult } from '../../core/types/index.js';

const log = createLogger('tools:http');

export class HttpTool implements Tool {
  readonly name = 'http';
  readonly description = '发起 HTTP 请求（GET / POST / PUT / DELETE）';
  readonly category = 'network';
  readonly inputSchema = {
    type: 'object',
    properties: {
      method: { type: 'string', description: 'HTTP 方法' },
      url: { type: 'string', description: '请求 URL' },
      headers: { type: 'object', description: '请求头' },
      body: { type: 'string', description: '请求体' },
    },
    required: ['method', 'url'],
  };

  async execute(
    args: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    log.info({ method: args.method, url: args.url }, 'HTTP 工具调用');
    return { success: true, status: 'success', result: { message: '占位实现' } };
  }
}
