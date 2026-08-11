/**
 * BaseOpenAICompatibleAdapter — OpenAI 协议基类
 *
 * DeepSeek、OpenAI 本地兼容服务、部分中转服务都使用 OpenAI Chat Completions 协议，
 * 这里抽出一个公共基类，子类只需覆盖 id / displayName / baseUrl 等元信息。
 *
 * @module @myopenclaw/server/agents/llm
 */

import { createLogger } from '../../core/utils/logger.js';
import { retry } from '../../core/utils/retry.js';
import { now, sleep } from '../../core/utils/time.js';
import { maskKey } from '../../core/utils/string.js';
import { ErrorCode } from '../../core/errors/index.js';
import type {
  DeepSeekOptions,
  LLMAdapter,
  LLMAdapterConfig,
  LLMChatInput,
  LLMChatOutput,
  LLMContentPart,
  LLMStreamChunk,
} from './types.js';
import {
  LLMError,
  LLMErrorCode,
  LLMErrorCodeType,
  LLMTimeoutError,
  NotSupportedLLMError,
  isRetryableLLMError,
} from './errors.js';

const log = createLogger('agent:llm:openai-compat');

/**
 * 清理 tool name,使其符合 OpenAI/DeepSeek 协议 ^[a-zA-Z0-9_-]+$
 * 不合法字符替换成 '_',空名兜底为 'tool'
 */
function sanitizeToolName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'tool';
}

/** OpenAI Chat Completions 协议请求体（含 DeepSeek 扩展字段） */
interface OpenAIChatRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
    /** DeepSeek 对话前缀续写（Beta） */
    prefix?: boolean;
    /** DeepSeek 推理链内容（用于多轮续写） */
    reasoning_content?: string;
  }>;
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
    /** DeepSeek strict mode（Beta） */
    strict?: boolean;
  }>;
  tool_choice?: string | { type: 'function'; function: { name: string } };
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  /** OpenAI 协议标准字段 */
  user?: string;
  stream?: boolean;
  /** DeepSeek 专有 */
  thinking?: { type: 'enabled' | 'disabled' };
  reasoning_effort?: string;
  response_format?: { type: 'text' | 'json_object' };
  stream_options?: { include_usage?: boolean };
  logprobs?: boolean;
  top_logprobs?: number;
  /** DeepSeek 业务侧用户 ID */
  user_id?: string;
  /** 其他厂商专有扩展（透传） */
  [key: string]: unknown;
}

interface OpenAIChatResponse {
  id: string;
  /** 创建时间戳（Unix 秒） */
  created?: number;
  model: string;
  /** 后端指纹（用于诊断配置变更） */
  system_fingerprint?: string;
  object?: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      /** DeepSeek 推理链内容（思考模式下） */
      reasoning_content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason:
      | 'stop'
      | 'tool_calls'
      | 'length'
      | 'content_filter'
      | 'insufficient_system_resource'
      | null;
    /** DeepSeek logprobs（logprobs=true 时返回） */
    logprobs?: unknown;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    /** DeepSeek KVCache */
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
    /** DeepSeek 扩展 */
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/** OpenAI 协议适配器基类选项 */
export interface OpenAICompatibleOptions {
  /** 子类必须提供：适配器 id（如 deepseek-chat） */
  id: string;
  /** 子类显示名称 */
  displayName: string;
  /** 协议 provider 标识 */
  provider: LLMAdapterConfig['provider'];
  /** 模型名称 */
  model: string;
  /** API Key */
  apiKey?: string;
  /** API 基础地址 */
  baseUrl: string;
  /** 路径模板，默认 /chat/completions */
  chatPath?: string;
  /** 上下文窗口大小 */
  contextWindow?: number;
  /** 默认生成参数 */
  defaultOptions?: LLMAdapterConfig['defaultOptions'];
  /** 请求超时 */
  timeoutMs?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 是否声明支持工具调用 */
  supportsToolCalls?: boolean;
  /** 是否声明支持流式 */
  supportsStreaming?: boolean;
  /** 自定义请求头 */
  extraHeaders?: Record<string, string>;
  /**
   * DeepSeek 专有参数(thinking / reasoning_effort / response_format 等)
   *
   * 由 LLMAdapterFactory.fromAgentConfig 从 YAML 注入。
   * 每次请求的 buildRequest 阶段与 input.deepseek 合并(input 优先)。
   */
  deepseekOptions?: DeepSeekOptions;
}

/**
 * 抽象基类：封装 OpenAI 协议适配器的公共逻辑
 *
 * 业务侧无需关心具体的 fetch 调用、重试与流式解析，
 * 只需继承并提供元数据（id / displayName / baseUrl）。
 */
export abstract class BaseOpenAICompatibleAdapter implements LLMAdapter {
  abstract readonly id: string;
  abstract readonly displayName: string;
  readonly provider: LLMAdapterConfig['provider'];
  readonly model: string;
  readonly supportsToolCalls: boolean;
  readonly supportsStreaming: boolean;
  readonly contextWindow: number;

  protected readonly apiKey?: string;
  protected readonly baseUrl: string;
  protected readonly chatPath: string;
  protected readonly defaultOptions?: LLMAdapterConfig['defaultOptions'];
  protected readonly timeoutMs: number;
  protected readonly maxRetries: number;
  protected readonly extraHeaders: Record<string, string>;
  /**
   * DeepSeek 专有默认参数(从 LLMAdapterConfig.deepseekOptions 传入)
   * 每次请求自动注入到请求体,无需 orchestrator 关心
   */
  protected readonly deepseekOptions?: DeepSeekOptions;

  constructor(opts: OpenAICompatibleOptions) {
    this.provider = opts.provider;
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.chatPath = opts.chatPath ?? '/chat/completions';
    this.contextWindow = opts.contextWindow ?? 8192;
    this.supportsToolCalls = opts.supportsToolCalls ?? true;
    this.supportsStreaming = opts.supportsStreaming ?? true;
    this.defaultOptions = opts.defaultOptions;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.deepseekOptions = opts.deepseekOptions;
    this.extraHeaders = opts.extraHeaders ?? {};
  }

  /** 同步对话 */
  async chat(input: LLMChatInput): Promise<LLMChatOutput> {
    const startedAt = now();
    const payload = this.buildRequest(input, false);

    // 调试日志:打印完整 messages 结构,用于定位 tool_call_id 缺失等问题
    // 设置 LLM_DEBUG_MESSAGES=1 启用
    if (process.env.LLM_DEBUG_MESSAGES === '1') {
      const dump = input.messages.map((m, i) => {
        const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
        return [
          `  [${i}] role=${m.role}`,
          `       contentLen=${c.length}`,
          `       toolCallId=${m.toolCallId ?? 'NONE'}`,
          `       toolCalls=${JSON.stringify(m.toolCalls?.map((tc) => ({ id: tc.id, name: tc.function.name })) ?? [])}`,
          `       head: ${c.slice(0, 100).replace(/\n/g, '\\n')}`,
          `       tail: ...${c.slice(-100).replace(/\n/g, '\\n')}`,
        ].join('\n');
      }).join('\n');
      process.stderr.write(
        `[DEBUG-MSG] === ${this.model} call with ${input.messages.length} messages ===\n${dump}\n\n`,
      );
    }

    log.debug(
      {
        provider: this.provider,
        model: this.model,
        messages: input.messages.length,
        tools: input.tools?.length ?? 0,
      },
      'OpenAI 兼容协议 - chat 请求',
    );

    const response = await this.invokeWithRetry(payload, input.signal);
    const output = this.parseResponse(response);

    log.info(
      {
        provider: this.provider,
        model: this.model,
        promptTokens: output.usage.promptTokens,
        completionTokens: output.usage.completionTokens,
        finishReason: output.finishReason,
        durationMs: now() - startedAt,
      },
      'OpenAI 兼容协议 - chat 响应',
    );

    return output;
  }

  /** 流式对话 */
  async *streamChat(input: LLMChatInput): AsyncIterable<LLMStreamChunk> {
    if (!this.supportsStreaming) {
      throw new LLMError({
        code: LLMErrorCode.NOT_SUPPORTED,
        message: '当前模型不支持流式输出',
        provider: this.provider,
        model: this.model,
        retryable: false,
      });
    }

    const payload = this.buildRequest(input, true);
    const controller = new AbortController();
    const externalSignal = input.signal;
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else externalSignal.addEventListener('abort', () => controller.abort(externalSignal.reason));
    }

    const timeoutHandle = setTimeout(() => controller.abort(new Error('timeout')), this.timeoutMs);

    try {
      const response = await this.fetchRaw(payload, controller.signal);
      if (!response.ok) {
        const errBody = await safeReadText(response);
        throw new LLMError({
          code: this.classifyHttpError(response.status, errBody),
          message: `流式 HTTP ${response.status}: ${errBody.slice(0, 200)}`,
          provider: this.provider,
          model: this.model,
          httpStatus: response.status,
          retryable: response.status >= 500 || response.status === 429,
        });
      }
      if (!response.body) {
        throw new LLMError({
          code: LLMErrorCode.INVALID_RESPONSE,
          message: '流式响应无 body',
          provider: this.provider,
          model: this.model,
          retryable: false,
        });
      }

      yield* this.parseSseStream(response.body, controller);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new LLMTimeoutError(this.provider, this.model, this.timeoutMs);
      }
      if (err instanceof LLMError) throw err;
      throw new LLMError({
        code: LLMErrorCode.NETWORK,
        message: `流式网络错误: ${(err as Error).message}`,
        provider: this.provider,
        model: this.model,
        retryable: true,
        cause: err,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /** embed 默认抛 NotSupported，子类可覆盖 */
  async embed(_text: string): Promise<number[]> {
    throw new NotSupportedLLMError('embed', this.provider, this.model);
  }

  /** 简单 token 估算：约 4 字符/token（英文），中文约 1.5 字/token */
  async countTokens(text: string): Promise<number> {
    if (!text) return 0;
    const cjk = (text.match(/[一-龥]/g) ?? []).length;
    const other = text.length - cjk;
    return Math.ceil(cjk / 1.5 + other / 4);
  }

  // ──────── 受保护的子类钩子 ────────

  /** 构造 fetch 请求所需的额外头（子类可覆盖） */
  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    return headers;
  }

  /** 构造请求体 */
  protected buildRequest(input: LLMChatInput, stream: boolean): OpenAIChatRequest {
    const opts = { ...(this.defaultOptions ?? {}), ...(input.options ?? {}) };
    const messages = input.messages.map((m) => this.transformMessage(m));
    // 运行时 model 覆盖: 允许 input.options.model 优先于 this.model
    // 约束: 调用方保证 model 同 provider, 否则会被 API 端拒绝
    const requestModel = input.options?.model ?? this.model;

    const req: OpenAIChatRequest = {
      model: requestModel,
      messages,
      stream,
    };

    if (input.tools && input.tools.length > 0 && this.supportsToolCalls) {
      req.tools = input.tools.map((t) => ({
        type: 'function',
        function: {
          // DeepSeek / OpenAI 硬约束:function.name 必须匹配 ^[a-zA-Z0-9_-]+$
          // 不合法字符替换成 '_',避免 400
          name: sanitizeToolName(t.name),
          description: t.description,
          parameters: t.parameters,
        },
      }));
      req.tool_choice = opts.toolChoice as OpenAIChatRequest['tool_choice'];
    }

    if (opts.temperature !== undefined) req.temperature = opts.temperature;
    if (opts.topP !== undefined) req.top_p = opts.topP;
    if (opts.maxTokens !== undefined) req.max_tokens = opts.maxTokens;
    if (opts.stop) req.stop = opts.stop;
    if (opts.presencePenalty !== undefined) req.presence_penalty = opts.presencePenalty;
    if (opts.frequencyPenalty !== undefined) req.frequency_penalty = opts.frequencyPenalty;
    if (opts.user) req.user = opts.user;

    // DeepSeek 专有参数（也可由其他 OpenAI 兼容厂商透传）
    // 合并策略:this.deepseekOptions(adapter 默认) < input.deepseek(per-call 覆盖)
    // 逐字段判断,input 有就用 input,否则用 adapter 默认
    const dsInput = input.deepseek;
    const dsDefault = this.deepseekOptions;
    const ds: DeepSeekOptions | undefined = dsInput ?? dsDefault;
    if (ds) {
      // thinking:input 优先
      const thinking = (dsInput?.thinking) ?? (dsDefault?.thinking);
      if (thinking) req.thinking = thinking;
      // reasoningEffort:input 优先
      const reasoningEffort = (dsInput?.reasoningEffort) ?? (dsDefault?.reasoningEffort);
      if (reasoningEffort) req.reasoning_effort = reasoningEffort;
      // responseFormat:input 优先
      const responseFormat = (dsInput?.responseFormat) ?? (dsDefault?.responseFormat);
      if (responseFormat) req.response_format = responseFormat;
      // userId:input 优先
      const userId = (dsInput?.userId) ?? (dsDefault?.userId);
      if (userId) req.user_id = userId;
      // streamOptions:input 优先
      const streamOptions = (dsInput?.streamOptions) ?? (dsDefault?.streamOptions);
      if (stream && streamOptions) {
        req.stream_options = {
          include_usage: streamOptions.includeUsage,
        };
      }
      // logprobs:input 优先(undefined 表示未设置)
      const logprobs = dsInput?.logprobs !== undefined ? dsInput.logprobs : dsDefault?.logprobs;
      if (logprobs !== undefined) {
        if (typeof logprobs === 'boolean') {
          req.logprobs = logprobs;
        } else {
          req.logprobs = logprobs.enabled;
          if (logprobs.topN !== undefined) req.top_logprobs = logprobs.topN;
        }
      }
      // strictTools:input 优先
      const strictTools = (dsInput?.strictTools) ?? (dsDefault?.strictTools);
      if (strictTools && req.tools) {
        for (const tool of req.tools) {
          (tool as { strict?: boolean }).strict = true;
        }
      }
    }

    // 透传 options.extra 中的任意额外字段
    if (opts.extra) {
      for (const [key, value] of Object.entries(opts.extra)) {
        if (value !== undefined) req[key] = value;
      }
    }

    return req;
  }

  /** 将统一消息转换为 OpenAI 协议消息 */
  protected transformMessage(m: LLMChatInput['messages'][number]): OpenAIChatRequest['messages'][number] {
    const base: OpenAIChatRequest['messages'][number] = {
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content.map((p) => this.transformPart(p)),
    };
    if (m.name) base.name = m.name;
    if (m.toolCallId) base.tool_call_id = m.toolCallId;
    if (m.toolCalls && m.toolCalls.length > 0) {
      base.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
    }
    // DeepSeek 对话前缀续写（Beta）：provider 可透传 assistant 思维链
    const extras = (m as unknown as { prefix?: boolean; reasoning_content?: string });
    if (extras.prefix) base.prefix = true;
    if (extras.reasoning_content) base.reasoning_content = extras.reasoning_content;
    return base;
  }

  /** 转换多模态内容片段 */
  protected transformPart(p: LLMContentPart): { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } } {
    if (p.type === 'image_url' && p.imageUrl) {
      return { type: 'image_url', image_url: { url: p.imageUrl.url } };
    }
    return { type: 'text', text: p.text ?? '' };
  }

  /** 解析非流式响应 */
  protected parseResponse(raw: OpenAIChatResponse): LLMChatOutput {
    const choice = raw.choices?.[0];
    if (!choice) {
      throw new LLMError({
        code: LLMErrorCode.INVALID_RESPONSE,
        message: '响应中无 choices',
        provider: this.provider,
        model: this.model,
        retryable: false,
      });
    }
    const usage = raw.usage ?? {};
    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));
    const out: LLMChatOutput = {
      content: choice.message.content ?? '',
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.normalizeFinishReason(choice.finish_reason, !!toolCalls?.length),
      usage: {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens:
          usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
        promptCacheHitTokens: usage.prompt_cache_hit_tokens,
        promptCacheMissTokens: usage.prompt_cache_miss_tokens,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
      },
      model: raw.model ?? this.model,
      raw,
    };
    // DeepSeek 扩展字段
    if (choice.message.reasoning_content) {
      out.reasoningContent = choice.message.reasoning_content;
    }
    if (raw.system_fingerprint) out.systemFingerprint = raw.system_fingerprint;
    if (raw.created) out.created = raw.created;
    return out;
  }

  /** 归一化结束原因 */
  protected normalizeFinishReason(reason: string | null, hasToolCalls: boolean): LLMChatOutput['finishReason'] {
    if (hasToolCalls) return 'tool_calls';
    if (reason === 'stop' || reason === null) return 'stop';
    if (reason === 'length') return 'length';
    if (reason === 'content_filter') return 'content_filter';
    if (reason === 'insufficient_system_resource') return 'insufficient_system_resource';
    return 'error';
  }

  // ──────── 网络请求与重试 ────────

  /** 通过重试调用 fetch */
  protected async invokeWithRetry(payload: OpenAIChatRequest, signal?: AbortSignal): Promise<OpenAIChatResponse> {
    return retry(() => this.fetchJson(payload, signal), {
      maxRetries: this.maxRetries,
      initialDelayMs: 200,
      backoffFactor: 2,
      maxDelayMs: 2000,
      shouldRetry: (err) => isRetryableLLMError(err),
    });
  }

  /** 发起 JSON 请求（带超时与错误标准化） */
  protected async fetchJson(payload: OpenAIChatRequest, signal?: AbortSignal): Promise<OpenAIChatResponse> {
    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', () => controller.abort(signal.reason));
    }
    const timer = setTimeout(() => controller.abort(new Error('timeout')), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchRaw(payload, controller.signal);
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        throw new LLMTimeoutError(this.provider, this.model, this.timeoutMs);
      }
      throw new LLMError({
        code: LLMErrorCode.NETWORK,
        message: `LLM 网络请求失败: ${(err as Error).message}`,
        provider: this.provider,
        model: this.model,
        retryable: true,
        cause: err,
      });
    }

    clearTimeout(timer);

    if (!response.ok) {
      const errBody = await safeReadText(response);
      const retryable = response.status >= 500 || response.status === 429;
      throw new LLMError({
        code: this.classifyHttpError(response.status, errBody),
        message: `LLM HTTP ${response.status}: ${errBody.slice(0, 200)}`,
        provider: this.provider,
        model: this.model,
        httpStatus: response.status,
        retryable,
      });
    }

    try {
      return (await response.json()) as OpenAIChatResponse;
    } catch (err) {
      throw new LLMError({
        code: LLMErrorCode.INVALID_RESPONSE,
        message: `LLM 响应 JSON 解析失败: ${(err as Error).message}`,
        provider: this.provider,
        model: this.model,
        retryable: false,
        cause: err,
      });
    }
  }

  /** 发起原始 fetch，子类可覆盖（如注入代理） */
  protected async fetchRaw(payload: OpenAIChatRequest, signal: AbortSignal): Promise<Response> {
    return fetch(`${this.baseUrl}${this.chatPath}`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(payload),
      signal,
    });
  }

  /** 根据 HTTP 状态归类错误码 */
  protected classifyHttpError(status: number, _body: string): LLMErrorCodeType | string {
    if (status === 401 || status === 403) return LLMErrorCode.INVALID_API_KEY;
    if (status === 429) return LLMErrorCode.RATE_LIMIT;
    if (status === 408) return LLMErrorCode.TIMEOUT;
    if (status === 413) return LLMErrorCode.CONTEXT_OVERFLOW;
    return LLMErrorCode.UNKNOWN;
  }

  /** 解析 SSE 流 */
  protected async *parseSseStream(
    body: ReadableStream<Uint8Array>,
    controller: AbortController,
  ): AsyncIterable<LLMStreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let cacheHitTokens = 0;
    let cacheMissTokens = 0;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const raw of lines) {
          const line = raw.trim();
          if (!line || !line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            yield {
              delta: '',
              done: true,
              usage: {
                promptTokens,
                completionTokens,
                totalTokens,
                promptCacheHitTokens: cacheHitTokens,
                promptCacheMissTokens: cacheMissTokens,
              },
            };
            return;
          }
          let parsed: {
            choices?: Array<{
              delta?: {
                content?: string | null;
                reasoning_content?: string | null;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
              prompt_cache_hit_tokens?: number;
              prompt_cache_miss_tokens?: number;
            };
          };
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }

          const choice = parsed.choices?.[0];
          if (choice?.delta?.content) {
            yield { delta: choice.delta.content, done: false };
          }
          // DeepSeek 思考模式：流式输出推理链
          if (choice?.delta?.reasoning_content) {
            yield { delta: '', done: false, reasoningDelta: choice.delta.reasoning_content };
          }
          if (choice?.delta?.tool_calls) {
            for (const tc of choice.delta.tool_calls) {
              yield {
                delta: '',
                done: false,
                toolCallDelta: {
                  id: tc.id,
                  function: tc.function
                    ? { name: tc.function.name ?? '', arguments: tc.function.arguments ?? '' }
                    : undefined,
                },
              };
            }
          }
          if (parsed.usage) {
            promptTokens = parsed.usage.prompt_tokens ?? promptTokens;
            completionTokens = parsed.usage.completion_tokens ?? completionTokens;
            totalTokens = parsed.usage.total_tokens ?? totalTokens;
            cacheHitTokens = parsed.usage.prompt_cache_hit_tokens ?? cacheHitTokens;
            cacheMissTokens = parsed.usage.prompt_cache_miss_tokens ?? cacheMissTokens;
          }
          if (choice?.finish_reason) {
            yield {
              delta: '',
              done: true,
              finishReason: this.normalizeFinishReason(choice.finish_reason, false),
              usage: {
                promptTokens,
                completionTokens,
                totalTokens,
                promptCacheHitTokens: cacheHitTokens,
                promptCacheMissTokens: cacheMissTokens,
              },
            };
            return;
          }
        }
      }

      // 流结束但无 finish_reason
      yield {
        delta: '',
        done: true,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
          promptCacheHitTokens: cacheHitTokens,
          promptCacheMissTokens: cacheMissTokens,
        },
      };
    } finally {
      controller.abort();
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
  }
}

/** 安全读取响应文本（不抛异常） */
async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/** 简单抑制未使用变量告警 */
void ErrorCode;
void sleep;
void maskKey;
