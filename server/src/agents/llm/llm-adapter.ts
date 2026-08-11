/**
 * UnifiedLLMAdapter — 统一封装的 LLM 适配器（支持主备回退）
 *
 * 文档参考：docs/05-Agent运行时模块.md §6.6
 *
 * 业务层只需持有 UnifiedLLMAdapter 引用，
 * 内部自动选择主适配器，失败时按顺序回退到备用适配器。
 *
 * @module @myopenclaw/server/agents/llm
 */

import { createLogger } from '../../core/utils/logger.js';
import { now } from '../../core/utils/time.js';
import { maskKey } from '../../core/utils/string.js';
import { LLMError, LLMErrorCode } from './errors.js';
import type {
  LLMAdapter,
  LLMChatInput,
  LLMChatOutput,
  LLMProvider,
  LLMStreamChunk,
  TokenUsage,
} from './types.js';

const log = createLogger('agent:llm:unified');

/** 主备回退配置 */
export interface UnifiedLLMAdapterConfig {
  /** 主适配器配置 */
  primary: LLMAdapter;
  /** 备用适配器列表（按顺序回退） */
  fallbacks?: LLMAdapter[];
  /** 是否在主适配器失败时回退（默认 true） */
  enableFallback?: boolean;
}

/**
 * 统一 LLM 适配器
 *
 * 用法：
 * ```ts
 * const primary = LLMAdapterFactory.create({ provider: 'claude', model: '...', apiKey });
 * const fallback = LLMAdapterFactory.create({ provider: 'deepseek', model: '...', apiKey });
 * const adapter = new UnifiedLLMAdapter({ primary, fallbacks: [fallback] });
 * ```
 */
export class UnifiedLLMAdapter implements LLMAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly provider: LLMProvider;
  readonly model: string;
  readonly supportsToolCalls: boolean;
  readonly supportsStreaming: boolean;
  readonly contextWindow: number;

  private readonly primary: LLMAdapter;
  private readonly fallbacks: LLMAdapter[];
  private readonly enableFallback: boolean;

  constructor(config: UnifiedLLMAdapterConfig) {
    if (!config.primary) {
      throw new LLMError({
        code: LLMErrorCode.UNKNOWN,
        message: 'UnifiedLLMAdapter 必须提供主适配器',
        retryable: false,
      });
    }
    this.primary = config.primary;
    this.fallbacks = config.fallbacks ?? [];
    this.enableFallback = config.enableFallback ?? true;

    this.id = this.primary.id;
    this.displayName = this.fallbacks.length > 0
      ? `${this.primary.displayName} (+${this.fallbacks.length} 备用)`
      : this.primary.displayName;
    this.provider = this.primary.provider;
    this.model = this.primary.model;
    this.supportsToolCalls = this.primary.supportsToolCalls;
    this.supportsStreaming = this.primary.supportsStreaming;
    this.contextWindow = this.primary.contextWindow;
  }

  /** 同步对话：主失败时按序回退 */
  async chat(input: LLMChatInput): Promise<LLMChatOutput> {
    const attempts: LLMAdapter[] = this.enableFallback ? [this.primary, ...this.fallbacks] : [this.primary];

    let lastError: unknown;
    for (const adapter of attempts) {
      try {
        log.debug({ adapter: adapter.id }, '尝试调用 LLM 适配器');
        const output = await adapter.chat(input);
        if (adapter !== this.primary) {
          log.warn(
            { primary: this.primary.id, fallback: adapter.id, maskedKey: maskKey(adapter.id) },
            '主模型失败，已回退到备用模型',
          );
        }
        return output;
      } catch (err) {
        lastError = err;
        const retryable = err instanceof LLMError ? err.retryable : false;
        log.warn(
          { adapter: adapter.id, error: (err as Error).message, retryable },
          'LLM 适配器调用失败',
        );
        if (!retryable || adapter === attempts[attempts.length - 1]) {
          throw err;
        }
      }
    }

    throw lastError ?? new LLMError({ message: '所有 LLM 适配器均不可用', retryable: false });
  }

  /** 流式对话：仅在主适配器上发起（回退路径上不支持流式） */
  async *streamChat(input: LLMChatInput): AsyncIterable<LLMStreamChunk> {
    if (!this.supportsStreaming) {
      throw new LLMError({
        code: LLMErrorCode.NOT_SUPPORTED,
        message: '当前统一适配器不支持流式输出',
        provider: this.provider,
        model: this.model,
        retryable: false,
      });
    }

    const startedAt = now();
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let finalFinishReason: LLMStreamChunk['finishReason'];

    try {
      const stream = this.primary.streamChat(input);
      for await (const chunk of stream) {
        if (chunk.usage) {
          promptTokens = chunk.usage.promptTokens;
          completionTokens = chunk.usage.completionTokens;
          totalTokens = chunk.usage.totalTokens;
        }
        if (chunk.finishReason) finalFinishReason = chunk.finishReason;
        yield chunk;
      }
    } catch (err) {
      if (this.enableFallback) {
        for (const fb of this.fallbacks) {
          if (!fb.supportsStreaming) continue;
          log.warn({ from: this.primary.id, to: fb.id }, '流式主适配器失败，回退到备用');
          const stream = fb.streamChat(input);
          for await (const chunk of stream) yield chunk;
          return;
        }
      }
      throw err;
    }
    log.info(
      { id: this.id, durationMs: now() - startedAt, promptTokens, completionTokens, totalTokens, finishReason: finalFinishReason },
      '流式对话结束',
    );
  }

  /** embed 仅委托主适配器 */
  async embed(text: string): Promise<number[]> {
    return this.primary.embed(text);
  }

  /** countTokens 委托主适配器 */
  async countTokens(text: string): Promise<number> {
    return this.primary.countTokens(text);
  }

  /** 暴露底层主适配器（用于高级配置） */
  getPrimary(): LLMAdapter {
    return this.primary;
  }

  /** 暴露备用适配器列表 */
  getFallbacks(): LLMAdapter[] {
    return [...this.fallbacks];
  }

  /** 聚合累计 token 用量（用于监控） */
  static aggregate(usages: TokenUsage[]): TokenUsage {
    return usages.reduce(
      (acc, u) => ({
        promptTokens: acc.promptTokens + u.promptTokens,
        completionTokens: acc.completionTokens + u.completionTokens,
        totalTokens: acc.totalTokens + u.totalTokens,
      }),
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    );
  }
}