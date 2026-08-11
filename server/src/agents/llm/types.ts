/**
 * LLM Adapter — 公共类型定义
 *
 * 文档参考：docs/05-Agent运行时模块.md §4.4
 *
 * 统一封装 OpenAI / Claude / DeepSeek / 本地开源模型所需的入参出参契约。
 * Agent 核心逻辑只依赖本文件中导出的类型，不感知底层模型差异。
 *
 * @module @myopenclaw/server/agents/llm
 */

/** 支持的 LLM 提供商 */
export type LLMProvider = 'openai' | 'claude' | 'deepseek' | 'local' | 'custom';

/** 适配器配置 */
export interface LLMAdapterConfig {
  /** 提供商标识 */
  provider: LLMProvider;
  /** 模型名称（如 gpt-4o、deepseek-chat、claude-3-5-sonnet-...） */
  model: string;
  /** API 密钥（local 提供商可为空） */
  apiKey?: string;
  /** 自定义 API 地址 */
  baseUrl?: string;
  /** 上下文窗口大小（token 数） */
  contextWindow?: number;
  /** 是否支持工具调用（function calling） */
  supportsToolCalls?: boolean;
  /** 是否支持流式输出 */
  supportsStreaming?: boolean;
  /** 默认生成参数 */
  defaultOptions?: Partial<LLMGenerateOptions>;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 适配器显示名称 */
  displayName?: string;
  /** 自定义请求头 */
  extraHeaders?: Record<string, string>;
  /**
   * DeepSeek 专有参数(thinking / reasoning_effort / response_format 等)
   *
   * 由 LLMAdapterFactory.fromAgentConfig 从 YAML 配置 `llm.deepseek.*` 注入。
   * BaseOpenAICompatibleAdapter 会在每次请求的 buildRequest 阶段与 input.deepseek
   * 合并(以 input 为优先),无需 orchestrator 关心。
   *
   * 非 deepseek 适配器可忽略此字段。
   */
  deepseekOptions?: DeepSeekOptions;
}

/** LLM 角色 */
export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

/** LLM 消息 */
export interface LLMMessage {
  role: LLMRole;
  content: string | LLMContentPart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
}

/** 多模态内容片段 */
export interface LLMContentPart {
  type: 'text' | 'image_url';
  text?: string;
  imageUrl?: { url: string; detail?: 'auto' | 'low' | 'high' };
}

/** LLM 工具调用 */
export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON 字符串 */
    arguments: string;
  };
}

/** LLM 工具定义（提供给模型的工具描述） */
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 生成参数（基础字段） */
export interface LLMGenerateOptions {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } } | string;
  presencePenalty?: number;
  frequencyPenalty?: number;
  user?: string;
  /**
   * 运行时覆盖 model（同 provider 下换档, e.g. deepseek-v4-pro -> deepseek-v4-flash）
   *
   * 约定: 只能在同一 provider 下的 model 间切换; 跨 provider 需要新建 adapter
   * (因为 baseUrl / apiKey / 协议可能不同)。
   * Adapter 在 buildRequest 时, input.options.model ?? this.model
   */
  model?: string;
  /** 厂商专有扩展参数（如 DeepSeek thinking / reasoning_effort / response_format / logprobs 等） */
  extra?: Record<string, unknown>;
}

/**
 * 响应格式约束（DeepSeek 等厂商支持）
 *  - text：默认文本输出
 *  - json_object：保证输出为合法 JSON
 */
export type LLMResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' };

/**
 * 思考模式控制（DeepSeek V4/R1 等推理模型）
 *
 * 文档参考：https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
 */
export interface LLMThinkingConfig {
  /** 是否开启思考模式 */
  type: 'enabled' | 'disabled';
}

/**
 * 推理强度（仅 DeepSeek V4 / R1 系列支持）
 *
 *  - high：默认强度，适用于多数请求
 *  - max：复杂 Agent 类请求（Claude Code、OpenCode）自动设置
 *
 * 出于兼容考虑 `low` / `medium` 会映射为 `high`，`xhigh` 映射为 `max`。
 */
export type LLMReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * Logprobs 输出选项
 */
export interface LLMLogprobsConfig {
  enabled: boolean;
  /** 取值范围 0~20 */
  topN?: number;
}

/**
 * 流式选项
 *
 * include_usage：是否在流式最后一个块之前再追加一块 usage 信息
 */
export interface LLMStreamOptions {
  includeUsage?: boolean;
}

/** DeepSeek 适配器专有扩展选项 */
export interface DeepSeekOptions {
  /** 思考模式开关（推荐 deepseek-v4-pro / deepseek-reasoner） */
  thinking?: LLMThinkingConfig;
  /** 推理强度（推荐 max 用于复杂 Agent 任务） */
  reasoningEffort?: LLMReasoningEffort;
  /** 响应格式（json_object 可保证合法 JSON 输出） */
  responseFormat?: LLMResponseFormat;
  /** 是否返回 token 对数概率 */
  logprobs?: boolean | LLMLogprobsConfig;
  /** 流式输出选项 */
  streamOptions?: LLMStreamOptions;
  /** 业务侧用户 ID（用于安全/KVCache/调度隔离） */
  userId?: string;
  /**
   * 启用 strict 模式（tool calls）— 函数输出严格符合 JSON Schema
   * 注：DeepSeek V4 当前为 Beta 功能
   */
  strictTools?: boolean;
}

/** LLM 对话输入 */
export interface LLMChatInput {
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  options?: LLMGenerateOptions;
  /** 信号量，用于外部取消请求 */
  signal?: AbortSignal;
  /**
   * DeepSeek 专有参数（仅 provider=deepseek 时生效）
   * 也可通过 options.extra 透传任意键值
   */
  deepseek?: DeepSeekOptions;
}

/** LLM 对话输出 */
export interface LLMChatOutput {
  content: string;
  toolCalls?: LLMToolCall[];
  finishReason: LLMFinishReason;
  usage: TokenUsage;
  /** 实际命中的模型（可能与配置不同） */
  model: string;
  /** 原始厂商响应（用于调试） */
  raw?: unknown;
  /**
   * 思考/推理内容（DeepSeek V4 / R1 等模型在思考模式下返回）
   * 业务层可用于展示"模型的思考过程"或调试
   */
  reasoningContent?: string;
  /** 提示缓存命中 token 数（DeepSeek KVCache） */
  promptCacheHitTokens?: number;
  /** 提示缓存未命中 token 数 */
  promptCacheMissTokens?: number;
  /** 推理消耗的 token 数（DeepSeek 扩展） */
  reasoningTokens?: number;
  /** 后端指纹（用于诊断，DeepSeek 返回 system_fingerprint） */
  systemFingerprint?: string;
  /** 响应创建时间戳（Unix 秒，DeepSeek 返回） */
  created?: number;
}

/** 结束原因 */
export type LLMFinishReason =
  | 'stop'
  | 'tool_calls'
  | 'length'
  | 'content_filter'
  | 'insufficient_system_resource'
  | 'error';

/** 流式输出 chunk */
export interface LLMStreamChunk {
  delta: string;
  toolCallDelta?: Partial<LLMToolCall>;
  done: boolean;
  usage?: TokenUsage;
  finishReason?: LLMFinishReason;
  /** 增量推理内容（DeepSeek V4 / R1 思考模式） */
  reasoningDelta?: string;
}

/** Token 使用统计 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** DeepSeek 上下文缓存命中 token（KVCache） */
  promptCacheHitTokens?: number;
  /** DeepSeek 上下文缓存未命中 token */
  promptCacheMissTokens?: number;
  /** DeepSeek 扩展：推理过程消耗的 token */
  reasoningTokens?: number;
}

/** LLM 适配器统一接口 */
export interface LLMAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly provider: LLMProvider;
  readonly model: string;
  readonly supportsToolCalls: boolean;
  readonly supportsStreaming: boolean;
  readonly contextWindow: number;

  /** 同步对话 */
  chat(input: LLMChatInput): Promise<LLMChatOutput>;
  /** 流式对话 */
  streamChat(input: LLMChatInput): AsyncIterable<LLMStreamChunk>;
  /** 文本向量化（不支持时抛 NotSupportedLLMError） */
  embed(text: string): Promise<number[]>;
  /** 统计 Token 数 */
  countTokens(text: string): Promise<number>;
}

/** 工具描述符（Planner 视角） */
export interface LLMToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
  builtin: boolean;
}