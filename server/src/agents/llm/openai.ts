/**
 * OpenAI 适配器
 *
 * OpenAI Chat Completions 协议的官方实现，继承自 BaseOpenAICompatibleAdapter。
 * 支持 GPT-3.5 / GPT-4 / GPT-4o / GPT-4o-mini / o1 系列等。
 *
 * 文档参考：docs/05-Agent运行时模块.md §2.3
 *
 * @module @myopenclaw/server/agents/llm
 */

import { BaseOpenAICompatibleAdapter } from './base-http-adapter.js';
import type { LLMAdapterConfig } from './types.js';

/** OpenAI 官方 API 地址 */
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/** OpenAI 常用模型上下文窗口 */
const OPENAI_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'gpt-3.5-turbo': 16_385,
  o1: 200_000,
  'o1-mini': 128_000,
  'o1-preview': 128_000,
};

/**
 * OpenAI 适配器
 */
export class OpenAIAdapter extends BaseOpenAICompatibleAdapter {
  readonly id: string;
  readonly displayName: string;

  constructor(config: LLMAdapterConfig) {
    super({
      id: `openai:${config.model}`,
      displayName: config.displayName ?? `OpenAI (${config.model})`,
      provider: 'openai',
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? OPENAI_DEFAULT_BASE_URL,
      contextWindow: config.contextWindow ?? OPENAI_CONTEXT_WINDOWS[config.model] ?? 16_385,
      defaultOptions: config.defaultOptions,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      supportsToolCalls: config.supportsToolCalls ?? true,
      supportsStreaming: config.supportsStreaming ?? true,
      extraHeaders: config.extraHeaders,
    });
    this.id = `openai:${config.model}`;
    this.displayName = config.displayName ?? `OpenAI (${config.model})`;
  }
}