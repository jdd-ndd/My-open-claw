/**
 * 内置钩子：日志记录
 *
 * 记录消息处理的关键节点，用于审计与排查。
 *
 * @module @myopenclaw/server/hooks/builtin
 */

import { registerHook } from '../registry.js';

registerHook({
  name: 'message-logging',
  event: 'message.post',
  priority: 100,
  handler: (ctx) => {
    const { message, response } = ctx.data;
    ctx.log('info', '消息处理完成', {
      messageId: message.id,
      sessionId: message.sessionId,
      responseLength: response.content.length,
      durationMs: Date.now() - message.timestamp,
    });
  },
});
