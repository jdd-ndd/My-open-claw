/**
 * LLM Adapter Factory — 按配置创建不同厂商的适配器实例
 *
 * 文档参考：docs/05-Agent运行时模块.md §6.1
 *
 * 使用示例：
 * ```ts
 * const adapter = LLMAdapterFactory.create({
 *   provider: 'deepseek',
 *   model: 'deepseek-chat',
 *   apiKey: process.env.DEEPSEEK_API_KEY,
 * });
 * ```
 *
 * @module @myopenclaw/server/agents/llm
 */

import { createLogger } from '../../core/utils/logger.js';
import { DeepSeekAdapter } from './deepseek.js';
import { OpenAIAdapter } from './openai.js';
import { ClaudeAdapter } from './claude.js';
import { LocalLLMAdapter } from './local.js';
import type { LLMAdapter, LLMAdapterConfig, LLMProvider } from './types.js';
import { LLMError, LLMErrorCode } from './errors.js';

const log = createLogger('agent:llm:factory');

/** 适配器构造函数签名 */
export type LLMAdapterCtor = (config: LLMAdapterConfig) => LLMAdapter;

/** 自定义适配器注册表 */
const customRegistry = new Map<LLMProvider | string, LLMAdapterCtor>();

/**
 * LLM 适配器工厂
 *
 * 默认内置 deepseek / openai / claude / local 四类适配器；
 * 业务可通过 register() 注入自定义厂商。
 */
export class LLMAdapterFactory {
  /** 注册自定义适配器构造器 */
  static register(provider: string, ctor: LLMAdapterCtor): void {
    customRegistry.set(provider, ctor);
    log.info({ provider }, '注册自定义 LLM 适配器');
  }

  /** 注销自定义适配器 */
  static unregister(provider: string): void {
    customRegistry.delete(provider);
  }

  /** 创建适配器实例 */
  static create(config: LLMAdapterConfig): LLMAdapter {
    if (!config.provider) {
      throw new LLMError({
        code: LLMErrorCode.UNKNOWN,
        message: '创建 LLM 适配器失败：缺少 provider 字段',
        retryable: false,
      });
    }
    if (!config.model) {
      throw new LLMError({
        code: LLMErrorCode.UNKNOWN,
        message: '创建 LLM 适配器失败：缺少 model 字段',
        provider: config.provider,
        retryable: false,
      });
    }

    const custom = customRegistry.get(config.provider);
    if (custom) {
      log.debug({ provider: config.provider, model: config.model }, '使用自定义适配器');
      return custom(config);
    }

    switch (config.provider) {
      case 'deepseek':
        return new DeepSeekAdapter(config);
      case 'openai':
        return new OpenAIAdapter(config);
      case 'claude':
        return new ClaudeAdapter(config);
      case 'local':
        return new LocalLLMAdapter(config);
      default:
        throw new LLMError({
          code: LLMErrorCode.UNKNOWN,
          message: `不支持的 LLM 提供商: ${String(config.provider)}`,
          provider: config.provider,
          model: config.model,
          retryable: false,
        });
    }
  }

  /** 从 YAML / 字典形式的 Agent 配置直接创建适配器 */
  static fromAgentConfig(agentConfig: Record<string, unknown>): LLMAdapter {
    const llm = (agentConfig.llm ?? {}) as Record<string, unknown>;
    const cfg: LLMAdapterConfig = {
      provider: (llm.provider as LLMProvider) ?? 'deepseek',
      model: (llm.model as string) ?? 'deepseek-chat',
      apiKey: this.resolveApiKey(llm.provider as string | undefined, llm.apiKey as string | undefined),
      baseUrl: llm.baseUrl as string | undefined,
      displayName: llm.displayName as string | undefined,
      contextWindow: llm.contextWindow as number | undefined,
      timeoutMs: llm.timeoutMs as number | undefined,
      maxRetries: llm.maxRetries as number | undefined,
      defaultOptions: llm.options as LLMAdapterConfig['defaultOptions'],
      extraHeaders: llm.extraHeaders as Record<string, string> | undefined,
      // 关键:从 YAML 读 deepseek 专有配置(thinking / reasoningEffort 等)
      // 没有这一行,YAML 里的 `deepseek.thinking: enabled` 会被静默丢弃,
      // 真实 LLM 端就不会开启思考模式 → TUI 看不到 reasoning
      deepseekOptions: llm.deepseek as LLMAdapterConfig['deepseekOptions'],
    };
    return LLMAdapterFactory.create(cfg);
  }

  /**
   * 解析 API Key：
   * 1. 优先使用显式传入的 key
   * 2. 否则从环境变量读取（DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY / LOCAL_LLM_API_KEY）
   */
  static resolveApiKey(provider?: string, explicit?: string): string | undefined {
    if (explicit && !explicit.startsWith('${')) return explicit;
    const envMatch = explicit?.match(/^\$\{(\w+)\}$/);
    if (envMatch) {
      return process.env[envMatch[1]] || undefined;
    }
    switch (provider) {
      case 'deepseek':
        return process.env.DEEPSEEK_API_KEY;
      case 'openai':
        return process.env.OPENAI_API_KEY;
      case 'claude':
        return process.env.ANTHROPIC_API_KEY;
      case 'local':
        return process.env.LOCAL_LLM_API_KEY ?? process.env.OLLAMA_API_KEY;
      default:
        return undefined;
    }
  }

  /** 列出已注册的自定义提供商 */
  static listCustomProviders(): string[] {
    return Array.from(customRegistry.keys());
  }
}