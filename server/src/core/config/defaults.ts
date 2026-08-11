/**
 * MyOpenClaw 默认配置
 *
 * 优先级链最底层: 任何更高优先级源(YAML / JSON / env)都会覆盖这里。
 * 值必须与 schema.ts 的 .default() 一致,否则会出现"schema 默认"和"内置默认"不一致。
 *
 * 重要: 这个文件**只描述 schema 字段的 fallback 值**,
 * 真正的"网络配置 LLM provider"等业务级默认在 factory.ts / agent-runtime-adapter.ts 里。
 *
 * @module @myopenclaw/server/core/config
 */

import { MyOpenClawConfigSchema } from './schema.js';
import type { MyOpenClawConfig } from './types.js';

/**
 * 完整默认配置
 *
 * 实现: 用 Zod schema 的 .parse({}) 触发所有 .default() 字段,
 * 加上必填字段的最小占位值(网络/llm/embedding/memory.persist/security 是必填,
 * 这里给出安全的占位,实际会被 YAML/JSON 覆盖)。
 */
export function getDefaultConfig(): MyOpenClawConfig {
  return MyOpenClawConfigSchema.parse({
    // 仅提供 schema 必填字段的占位
    network: {
      ws: { host: '127.0.0.1', port: 18780 },
      http: { host: '127.0.0.1', port: 18790 },
    },
    llm: {
      provider: 'deepseek',
      // 占位字符串: 让 schema refine 通过(provider≠ollama 时 apiKey 非空),
      // 实际启动期 validator 会检测 "placeholder" 字样并 fatal,提醒用户必须显式覆盖
      apiKey: '__PLACEHOLDER_OVERRIDE_VIA_ENV_OR_JSON__',
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
      models: [
        {
          id: 'deepseek-v4-flash',
          contextWindow: 128_000,
          maxOutputTokens: 8_192,
        },
      ],
    },
    embedding: {
      provider: 'openai',
      apiKey: '__PLACEHOLDER_OVERRIDE_VIA_ENV_OR_JSON__',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    },
    memory: {
      persist: { backend: 'sqlite', path: '~/.myopenclaw/data/memory.db' },
    },
    security: {
      // authToken 占位(由 Zod .min(16) 校验)
      authToken: 'dev-only-default-token-please-change',
      sandbox: { workDir: '~/.myopenclaw/workspace' },
    },
  });
}
