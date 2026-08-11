/**
 * LLM 错误类 — 统一错误类型
 *
 * 文档参考：docs/05-Agent运行时模块.md §4.4
 *
 * 所有 LLM 适配器在出现异常时统一抛出 LLMError，
 * 由上层根据 retryable 字段决定是否重试或回退到备用模型。
 *
 * @module @myopenclaw/server/agents/llm
 */

import { AppError, ErrorCode } from '../../core/errors/index.js';

/** 常见 LLM 错误码（同时复用 core/errors 的 700xxx 分段） */
export const LLMErrorCode = {
  /** API Key 无效 */
  INVALID_API_KEY: 'LLM_API_KEY_INVALID',
  /** 触发限流 */
  RATE_LIMIT: 'LLM_RATE_LIMIT',
  /** 请求超时 */
  TIMEOUT: 'LLM_TIMEOUT',
  /** 上下文超出窗口 */
  CONTEXT_OVERFLOW: 'LLM_CONTEXT_OVERFLOW',
  /** 厂商返回无效响应 */
  INVALID_RESPONSE: 'LLM_INVALID_RESPONSE',
  /** 模型不支持该能力 */
  NOT_SUPPORTED: 'LLM_NOT_SUPPORTED',
  /** 通用错误 */
  UNKNOWN: 'LLM_UNKNOWN',
  /** 网络错误 */
  NETWORK: 'LLM_NETWORK',
} as const;

export type LLMErrorCodeType = (typeof LLMErrorCode)[keyof typeof LLMErrorCode];

/**
 * LLM 错误
 *
 * 相比 AppError 增加了 code（厂商错误码）与 provider/model 字段，
 * 便于上层日志排查和指标打点。
 */
export class LLMError extends AppError {
  /** 业务错误码（LLM_*） */
  public readonly llmCode: LLMErrorCodeType | string;
  /** 提供商 */
  public readonly provider?: string;
  /** 模型 */
  public readonly model?: string;
  /** HTTP 状态码（如有） */
  public readonly httpStatus?: number;

  constructor(params: {
    code?: LLMErrorCodeType | string;
    message: string;
    provider?: string;
    model?: string;
    httpStatus?: number;
    retryable?: boolean;
    cause?: unknown;
    details?: Array<{ field: string; message: string }>;
  }) {
    super({
      code: ErrorCode.LLM_ERROR,
      message: params.message,
      statusCode: params.httpStatus && params.httpStatus >= 400 ? params.httpStatus : 502,
      retryable: params.retryable ?? false,
      details: params.details,
      cause: params.cause,
    });
    this.name = 'LLMError';
    this.llmCode = params.code ?? LLMErrorCode.UNKNOWN;
    this.provider = params.provider;
    this.model = params.model;
    this.httpStatus = params.httpStatus;
    Object.setPrototypeOf(this, LLMError.prototype);
  }

  /** 序列化为日志友好结构 */
  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      llmCode: this.llmCode,
      provider: this.provider,
      model: this.model,
      httpStatus: this.httpStatus,
    };
  }
}

/** 不支持能力错误（不可重试） */
export class NotSupportedLLMError extends LLMError {
  constructor(feature: string, provider?: string, model?: string) {
    super({
      code: LLMErrorCode.NOT_SUPPORTED,
      message: `当前模型不支持能力: ${feature}`,
      provider,
      model,
      retryable: false,
    });
    this.name = 'NotSupportedLLMError';
    Object.setPrototypeOf(this, NotSupportedLLMError.prototype);
  }
}

/** 超时错误（可重试） */
export class LLMTimeoutError extends LLMError {
  constructor(provider?: string, model?: string, timeoutMs?: number) {
    super({
      code: LLMErrorCode.TIMEOUT,
      message: timeoutMs ? `LLM 请求超时（${timeoutMs}ms）` : 'LLM 请求超时',
      provider,
      model,
      retryable: true,
    });
    this.name = 'LLMTimeoutError';
    Object.setPrototypeOf(this, LLMTimeoutError.prototype);
  }
}

/** 判断错误是否为可重试的 LLM 错误 */
export function isRetryableLLMError(err: unknown): boolean {
  if (err instanceof LLMError) return err.retryable;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}