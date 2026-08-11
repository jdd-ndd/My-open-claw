import type { InvokeContext, JSONSchema, Tool, ToolResult } from '../../core/types/index.js';

export { PptMakeTool } from './ppt/index.js';

export class SystemTimeTool implements Tool {
  readonly name = 'system/time';
  readonly description = 'Return the current server time for real-time questions such as what time it is now.';
  readonly category = 'system';
  readonly risk: 'low' | 'medium' | 'high' = 'low';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      timezone: { type: 'string', description: 'Optional IANA timezone, for example Asia/Shanghai.' },
      locale: { type: 'string', description: 'Optional locale used to format the display time.' },
    },
    required: [],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    const now = new Date();
    const timezone = typeof params.timezone === 'string' && params.timezone.trim() ? params.timezone.trim() : 'Asia/Shanghai';
    const locale = typeof params.locale === 'string' && params.locale.trim() ? params.locale.trim() : 'zh-CN';

    let formatted = now.toLocaleString(locale);
    try {
      formatted = new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now);
    } catch {
      // Fall back to the environment default formatter when timezone or locale is invalid.
    }

    return {
      success: true,
      status: 'success',
      data: {
        isoTime: now.toISOString(),
        unixMs: now.getTime(),
        timezone,
        locale,
        formatted,
      },
      metadata: {
        durationMs: Date.now() - startedAt,
        sideEffects: [],
      },
    };
  }
}
