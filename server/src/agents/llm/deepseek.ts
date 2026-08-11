/**
 * DeepSeek 适配器
 *
 * 文档参考：
 * - 官方 API 文档：https://api-docs.deepseek.com/zh-cn/
 * - 对话补全：https://api-docs.deepseek.com/zh-cn/api/create-chat-completion
 * - 思考模式：https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
 * - Anthropic API 兼容：https://api-docs.deepseek.com/zh-cn/guides/anthropic_api
 * - 错误码：https://api-docs.deepseek.com/zh-cn/quick_start/error_codes
 * - 限速：https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit
 *
 * DeepSeek API 与 OpenAI Chat Completions 完全兼容，
 * 直接继承 BaseOpenAICompatibleAdapter，仅配置 baseUrl 即可。
 *
 * @module @myopenclaw/server/agents/llm
 */

import { BaseOpenAICompatibleAdapter } from './base-http-adapter.js';
import type { LLMAdapterConfig } from './types.js';

/** DeepSeek 默认 API 地址 */
export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com';

/** DeepSeek 支持的常用模型
 *
 * - V4 系列（2026 年新模型）：默认开启思考模式
 * - chat / reasoner 系列将于 2026/07/24 弃用，分别对应 V4 flash 的非思考 / 思考模式
 */
export const DEEPSEEK_MODELS = {
  /** 通用对话（V4 flash，非思考模式） */
  V4_FLASH: 'deepseek-v4-flash',
  /** 高质量推理（V4 pro，思考模式） */
  V4_PRO: 'deepseek-v4-pro',
  /** 通用对话（即将弃用，对应 deepseek-v4-flash 非思考模式） */
  CHAT: 'deepseek-chat',
  /** 推理增强（即将弃用，对应 deepseek-v4-flash 思考模式） */
  REASONER: 'deepseek-reasoner',
} as const;

/** DeepSeek 模型上下文窗口大小（token） */
export const DEEPSEEK_CONTEXT_WINDOWS: Record<string, number> = {
  'deepseek-v4-flash': 128_000,
  'deepseek-v4-pro': 128_000,
  'deepseek-chat': 32_768,
  'deepseek-reasoner': 64_000,
};

/** DeepSeek 模型默认输出上限（max_tokens） */
export const DEEPSEEK_DEFAULT_MAX_TOKENS: Record<string, number> = {
  'deepseek-v4-flash': 8192,
  'deepseek-v4-pro': 8192,
  'deepseek-chat': 4096,
  'deepseek-reasoner': 8192,
};

/** DeepSeek 模型是否默认开启思考模式 */
export const DEEPSEEK_DEFAULT_THINKING: Record<string, 'enabled' | 'disabled'> = {
  'deepseek-v4-flash': 'enabled',
  'deepseek-v4-pro': 'enabled',
  'deepseek-chat': 'disabled',
  'deepseek-reasoner': 'enabled',
};

/**
 * DeepSeek 适配器
 *
 * 默认 baseUrl 指向 DeepSeek 官方 API，
 * 可通过 config.baseUrl 覆盖（如使用中转服务）。
 *
 * 配置示例：
 * ```ts
 * LLMAdapterFactory.create({
 *   provider: 'deepseek',
 *   model: 'deepseek-v4-pro',
 *   apiKey: process.env.DEEPSEEK_API_KEY,
 *   defaultOptions: {
 *     temperature: 0.7,
 *     maxTokens: 4096,
 *   },
 * });
 * ```
 */
export class DeepSeekAdapter extends BaseOpenAICompatibleAdapter {
  readonly id: string;
  readonly displayName: string;

  constructor(config: LLMAdapterConfig) {
    super({
      id: `deepseek:${config.model}`,
      displayName: config.displayName ?? `DeepSeek (${config.model})`,
      provider: 'deepseek',
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? DEEPSEEK_DEFAULT_BASE_URL,
      contextWindow: config.contextWindow ?? DEEPSEEK_CONTEXT_WINDOWS[config.model] ?? 32_768,
      defaultOptions: {
        ...config.defaultOptions,
        maxTokens: config.defaultOptions?.maxTokens ?? DEEPSEEK_DEFAULT_MAX_TOKENS[config.model] ?? 4096,
      },
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      supportsToolCalls: config.supportsToolCalls ?? true,
      supportsStreaming: config.supportsStreaming ?? true,
      extraHeaders: config.extraHeaders,
      // 透传 deepseek 专有配置(thinking / reasoningEffort / responseFormat 等)
      // LLMAdapterFactory.fromAgentConfig 从 YAML llm.deepseek.* 注入
      // 这里若未传,只设 thinking(基于模型默认表),其他字段保持空
      // — 避免意外给非 YAML 路径创建的适配器注入过多默认,影响测试和直构造场景
      deepseekOptions: config.deepseekOptions ?? {
        thinking: { type: DEEPSEEK_DEFAULT_THINKING[config.model] ?? 'enabled' },
      },
    });
    this.id = `deepseek:${config.model}`;
    this.displayName = config.displayName ?? `DeepSeek (${config.model})`;
  }

  /** 当前模型默认是否开启思考模式 */
  get defaultThinkingMode(): 'enabled' | 'disabled' {
    return DEEPSEEK_DEFAULT_THINKING[this.model] ?? 'enabled';
  }

  /** 当前模型默认 max_tokens 推荐值 */
  get recommendedMaxTokens(): number {
    return DEEPSEEK_DEFAULT_MAX_TOKENS[this.model] ?? 4096;
  }
}