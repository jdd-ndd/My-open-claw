/**
 * 本地 LLM 适配器（Ollama / llama.cpp 等 OpenAI 兼容服务）
 *
 * 本地模型通常通过 Ollama 或 llama.cpp 暴露 OpenAI 协议端点，
 * 因此本适配器直接复用 BaseOpenAICompatibleAdapter。
 *
 * 文档参考：docs/05-Agent运行时模块.md §6.5
 *
 * @module @myopenclaw/server/agents/llm
 */

import { BaseOpenAICompatibleAdapter } from './base-http-adapter.js';
import type { LLMAdapterConfig } from './types.js';

/** Ollama 默认 API 地址（提供 /v1 OpenAI 兼容端点） */
export const LOCAL_DEFAULT_BASE_URL = 'http://localhost:11434/v1';

/**
 * 本地 LLM 适配器
 *
 * - apiKey 可为空（Ollama 默认不要求鉴权）
 * - 默认 baseUrl 指向 Ollama 的 /v1 OpenAI 兼容端点
 * - supportsToolCalls 默认为 false（本地小模型多数不支持原生 function calling，
 *   可通过系统提示词引导输出结构化动作，由 Planner 解析）
 */
export class LocalLLMAdapter extends BaseOpenAICompatibleAdapter {
  readonly id: string;
  readonly displayName: string;

  constructor(config: LLMAdapterConfig) {
    super({
      id: `local:${config.model}`,
      displayName: config.displayName ?? `Local (${config.model})`,
      provider: 'local',
      model: config.model,
      apiKey: config.apiKey ?? 'ollama',
      baseUrl: config.baseUrl ?? LOCAL_DEFAULT_BASE_URL,
      contextWindow: config.contextWindow ?? 8192,
      defaultOptions: config.defaultOptions,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      // 本地模型默认禁用原生 function calling
      supportsToolCalls: config.supportsToolCalls ?? false,
      supportsStreaming: config.supportsStreaming ?? true,
      extraHeaders: config.extraHeaders,
    });
    this.id = `local:${config.model}`;
    this.displayName = config.displayName ?? `Local (${config.model})`;
  }
}