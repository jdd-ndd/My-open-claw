/**
 * LLM Adapter — 多模型适配器统一导出
 *
 * 文档参考：docs/05-Agent运行时模块.md §2.3
 *
 * 统一封装 OpenAI / Claude / DeepSeek / 本地开源模型接口，
 * 切换模型无需修改 Agent 核心逻辑。
 *
 * @module @myopenclaw/server/agents/llm
 */

// ── 适配器实现 ──
export { BaseOpenAICompatibleAdapter } from './base-http-adapter.js';
export { DeepSeekAdapter, DEEPSEEK_DEFAULT_BASE_URL, DEEPSEEK_MODELS } from './deepseek.js';
export { OpenAIAdapter, OPENAI_DEFAULT_BASE_URL } from './openai.js';
export { ClaudeAdapter, CLAUDE_DEFAULT_BASE_URL } from './claude.js';
export { LocalLLMAdapter, LOCAL_DEFAULT_BASE_URL } from './local.js';

// ── 工厂与统一封装 ──
export { LLMAdapterFactory } from './factory.js';
export type { LLMAdapterCtor } from './factory.js';
export { UnifiedLLMAdapter } from './llm-adapter.js';
export type { UnifiedLLMAdapterConfig } from './llm-adapter.js';

// ── PromptBuilder ──
export { PromptBuilder, createPromptBuilder } from './prompt.js';
export type { PromptBuilderInput } from './prompt.js';

// ── 错误类型 ──
export { LLMError, LLMTimeoutError, NotSupportedLLMError, isRetryableLLMError } from './errors.js';
export { LLMErrorCode } from './errors.js';
export type { LLMErrorCodeType } from './errors.js';

// ── 类型导出 ──
export type {
  LLMAdapter,
  LLMAdapterConfig,
  LLMProvider,
  LLMRole,
  LLMMessage,
  LLMContentPart,
  LLMToolCall,
  LLMToolDefinition,
  LLMToolDescriptor,
  LLMGenerateOptions,
  LLMChatInput,
  LLMChatOutput,
  LLMStreamChunk,
  LLMFinishReason,
  TokenUsage,
  LLMResponseFormat,
  LLMThinkingConfig,
  LLMReasoningEffort,
  LLMLogprobsConfig,
  LLMStreamOptions,
  DeepSeekOptions,
} from './types.js';