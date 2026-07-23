/**
 * 内置钩子：指标采集
 *
 * 统计 LLM 调用次数与延迟，供监控使用。
 *
 * @module @myopenclaw/server/hooks/builtin
 */

import { registerHook } from '../registry.js';

registerHook({
  name: 'llm-metrics',
  event: 'llm.post',
  priority: 100,
  handler: (ctx) => {
    const { model, tokensIn, tokensOut, durationMs } = ctx.data;
    ctx.log('info', 'LLM 调用指标', { model, tokensIn, tokensOut, durationMs });
  },
});
