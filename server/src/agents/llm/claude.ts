/**
 * Claude 适配器（Anthropic Messages API）
 *
 * Claude 使用 Anthropic 自家的 Messages 协议，与 OpenAI 不兼容，
 * 因此本适配器不继承 BaseOpenAICompatibleAdapter，独立实现 HTTP 调用。
 *
 * 文档参考：docs/05-Agent运行时模块.md §2.3
 *
 * @module @myopenclaw/server/agents/llm
 */

import { createLogger } from '../../core/utils/logger.js';
import { retry } from '../../core/utils/retry.js';
import { now } from '../../core/utils/time.js';
import { ErrorCode } from '../../core/errors/index.js';
import {
  LLMError,
  LLMErrorCode,
  LLMErrorCodeType,
  LLMTimeoutError,
  NotSupportedLLMError,
  isRetryableLLMError,
} from './errors.js';
import type {
  LLMAdapter,
  LLMAdapterConfig,
  LLMChatInput,
  LLMChatOutput,
  LLMMessage,
  LLMStreamChunk,
} from './types.js';

const log = createLogger('agent:llm:claude');

/** Anthropic Messages API 请求体 */
interface ClaudeRequest {
  model: string;
  system?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<unknown>;
  }>;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  stream?: boolean;
}

/** Anthropic Messages API 响应体 */
interface ClaudeResponse {
  id: string;
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | string | null;
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/** Claude 默认 API 地址 */
export const CLAUDE_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';

/** Claude 常用模型上下文窗口 */
const CLAUDE_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-sonnet-20240620': 200_000,
  'claude-3-opus-20240229': 200_000,
  'claude-3-haiku-20240307': 200_000,
};

/**
 * Anthropic Claude 适配器
 */
export class ClaudeAdapter implements LLMAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly provider = 'claude' as const;
  readonly model: string;
  readonly supportsToolCalls = true;
  readonly supportsStreaming = true;
  readonly contextWindow: number;

  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly defaultOptions?: LLMAdapterConfig['defaultOptions'];
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly extraHeaders: Record<string, string>;

  constructor(config: LLMAdapterConfig) {
    this.id = `claude:${config.model}`;
    this.displayName = config.displayName ?? `Claude (${config.model})`;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? CLAUDE_DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.contextWindow = config.contextWindow ?? CLAUDE_CONTEXT_WINDOWS[config.model] ?? 200_000;
    this.defaultOptions = config.defaultOptions;
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.maxRetries = config.maxRetries ?? 2;
    this.extraHeaders = config.extraHeaders ?? {};
  }

  /** 同步对话 */
  async chat(input: LLMChatInput): Promise<LLMChatOutput> {
    const startedAt = now();
    const payload = this.buildRequest(input);

    log.debug(
      { provider: 'claude', model: this.model, messages: input.messages.length },
      'Claude chat 请求',
    );

    const response = await this.invokeWithRetry(payload, input.signal);
    const output = this.parseResponse(response);

    log.info(
      {
        provider: 'claude',
        model: this.model,
        promptTokens: output.usage.promptTokens,
        completionTokens: output.usage.completionTokens,
        durationMs: now() - startedAt,
      },
      'Claude chat 响应',
    );

    return output;
  }

  /** 流式对话（SSE） */
  async *streamChat(input: LLMChatInput): AsyncIterable<LLMStreamChunk> {
    if (!this.supportsStreaming) {
      throw new NotSupportedLLMError('streamChat', this.provider, this.model);
    }

    const payload = { ...this.buildRequest(input), stream: true };
    const controller = new AbortController();
    const ext = input.signal;
    if (ext) {
      if (ext.aborted) controller.abort(ext.reason);
      else ext.addEventListener('abort', () => controller.abort(ext.reason));
    }
    const timer = setTimeout(() => controller.abort(new Error('timeout')), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errBody = await response.text();
        throw new LLMError({
          code: this.classifyHttpError(response.status),
          message: `Claude HTTP ${response.status}: ${errBody.slice(0, 200)}`,
          provider: this.provider,
          model: this.model,
          httpStatus: response.status,
          retryable: response.status >= 500,
        });
      }
      if (!response.body) {
        throw new LLMError({
          code: LLMErrorCode.INVALID_RESPONSE,
          message: 'Claude 流式响应无 body',
          provider: this.provider,
          model: this.model,
          retryable: false,
        });
      }
      yield* this.parseSseStream(response.body);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Claude Messages API 不原生支持通用 embed */
  async embed(_text: string): Promise<number[]> {
    throw new NotSupportedLLMError('embed', this.provider, this.model);
  }

  /** 简单 token 估算 */
  async countTokens(text: string): Promise<number> {
    if (!text) return 0;
    const cjk = (text.match(/[一-龥]/g) ?? []).length;
    const other = text.length - cjk;
    return Math.ceil(cjk / 1.5 + other / 4);
  }

  // ──────── 内部实现 ────────

  protected buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...this.extraHeaders,
      ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
    };
  }

  /** 构造 Claude Messages 请求体 */
  protected buildRequest(input: LLMChatInput): ClaudeRequest {
    const opts = { ...(this.defaultOptions ?? {}), ...(input.options ?? {}) };
    const systemMessages: string[] = [];
    const chatMessages: ClaudeRequest['messages'] = [];

    for (const m of input.messages) {
      const text = this.extractText(m);
      if (m.role === 'system') {
        systemMessages.push(text);
      } else if (m.role === 'user') {
        chatMessages.push({ role: 'user', content: text });
      } else if (m.role === 'assistant') {
        chatMessages.push({ role: 'assistant', content: text });
      }
      // tool 角色的消息被合并到对应 user 消息里（简化处理）
    }

    const req: ClaudeRequest = {
      model: this.model,
      messages: chatMessages,
      max_tokens: opts.maxTokens ?? 4096,
    };
    if (systemMessages.length > 0) req.system = systemMessages.join('\n');
    if (opts.temperature !== undefined) req.temperature = opts.temperature;
    if (opts.topP !== undefined) req.top_p = opts.topP;
    if (opts.stop) req.stop_sequences = opts.stop;

    if (input.tools && input.tools.length > 0) {
      req.tools = input.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    return req;
  }

  /** 提取消息文本 */
  protected extractText(m: LLMMessage): string {
    if (typeof m.content === 'string') return m.content;
    return m.content
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('');
  }

  /** 解析 Claude 响应 */
  protected parseResponse(raw: ClaudeResponse): LLMChatOutput {
    const textParts: string[] = [];
    const toolCalls: LLMChatOutput['toolCalls'] = [];

    for (const block of raw.content) {
      if (block.type === 'text') textParts.push(block.text);
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      }
    }

    return {
      content: textParts.join(''),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.normalizeFinishReason(raw.stop_reason, toolCalls.length > 0),
      usage: {
        promptTokens: raw.usage?.input_tokens ?? 0,
        completionTokens: raw.usage?.output_tokens ?? 0,
        totalTokens: (raw.usage?.input_tokens ?? 0) + (raw.usage?.output_tokens ?? 0),
      },
      model: raw.model ?? this.model,
      raw,
    };
  }

  /** 归一化结束原因 */
  protected normalizeFinishReason(reason: string | null, hasToolCalls: boolean): LLMChatOutput['finishReason'] {
    if (hasToolCalls) return 'tool_calls';
    if (reason === 'end_turn' || reason === 'stop_sequence' || reason === null) return 'stop';
    if (reason === 'max_tokens') return 'length';
    return 'error';
  }

  protected classifyHttpError(status: number): LLMErrorCodeType | string {
    if (status === 401 || status === 403) return LLMErrorCode.INVALID_API_KEY;
    if (status === 429) return LLMErrorCode.RATE_LIMIT;
    if (status === 408) return LLMErrorCode.TIMEOUT;
    if (status === 413) return LLMErrorCode.CONTEXT_OVERFLOW;
    return LLMErrorCode.UNKNOWN;
  }

  protected async invokeWithRetry(payload: ClaudeRequest, signal?: AbortSignal): Promise<ClaudeResponse> {
    return retry(() => this.fetchJson(payload, signal), {
      maxRetries: this.maxRetries,
      initialDelayMs: 200,
      backoffFactor: 2,
      maxDelayMs: 2000,
      shouldRetry: (err) => isRetryableLLMError(err),
    });
  }

  protected async fetchJson(payload: ClaudeRequest, signal?: AbortSignal): Promise<ClaudeResponse> {
    const controller = new AbortController();
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', () => controller.abort(signal.reason));
    }
    const timer = setTimeout(() => controller.abort(new Error('timeout')), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        throw new LLMTimeoutError(this.provider, this.model, this.timeoutMs);
      }
      throw new LLMError({
        code: LLMErrorCode.NETWORK,
        message: `Claude 网络请求失败: ${(err as Error).message}`,
        provider: this.provider,
        model: this.model,
        retryable: true,
        cause: err,
      });
    }

    clearTimeout(timer);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new LLMError({
        code: this.classifyHttpError(response.status),
        message: `Claude HTTP ${response.status}: ${errBody.slice(0, 200)}`,
        provider: this.provider,
        model: this.model,
        httpStatus: response.status,
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    try {
      return (await response.json()) as ClaudeResponse;
    } catch (err) {
      throw new LLMError({
        code: LLMErrorCode.INVALID_RESPONSE,
        message: `Claude 响应 JSON 解析失败: ${(err as Error).message}`,
        provider: this.provider,
        model: this.model,
        retryable: false,
        cause: err,
      });
    }
  }

  /** 解析 Anthropic SSE 流 */
  protected async *parseSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<LLMStreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;

          let evt: { type?: string; delta?: { type?: string; text?: string }; message?: { usage?: { input_tokens?: number; output_tokens?: number } } };
          try {
            evt = JSON.parse(data);
          } catch {
            continue;
          }

          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
            yield { delta: evt.delta.text, done: false };
          }
          if (evt.type === 'message_delta' && evt.message?.usage) {
            outputTokens = evt.message.usage.output_tokens ?? outputTokens;
          }
          if (evt.type === 'message_start' && evt.message?.usage) {
            inputTokens = evt.message.usage.input_tokens ?? inputTokens;
          }
          if (evt.type === 'message_stop') {
            yield {
              delta: '',
              done: true,
              usage: { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens },
            };
            return;
          }
        }
      }
      yield {
        delta: '',
        done: true,
        usage: { promptTokens: inputTokens, completionTokens: outputTokens, totalTokens: inputTokens + outputTokens },
      };
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
  }
}

void ErrorCode;