/**
 * 内置钩子：数据脱敏
 *
 * 在消息进入 Agent Runtime 前脱敏敏感信息（手机号、身份证号）。
 *
 * @module @myopenclaw/server/hooks/builtin
 */

import { registerHook } from '../registry.js';
import type { HookContext } from '../types.js';

registerHook({
  name: 'sanitize-sensitive-data',
  event: 'message.pre',
  priority: 10,
  handler: (ctx: HookContext<'message.pre'>) => {
    const { message } = ctx.data;
    let sanitized = message.content.replace(
      /1[3-9]\d{9}/g,
      (match) => match.slice(0, 3) + '****' + match.slice(-4),
    );
    sanitized = sanitized.replace(
      /\d{17}[\dXx]/g,
      (match) => match.slice(0, 6) + '********' + match.slice(-4),
    );
    if (sanitized !== message.content) {
      ctx.mutate({ message: { ...message, content: sanitized } });
      ctx.log('debug', '消息已脱敏', { messageId: message.id });
    }
  },
});
