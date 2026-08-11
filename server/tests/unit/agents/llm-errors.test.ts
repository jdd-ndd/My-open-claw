/**
 * LLM 错误类单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  LLMError,
  LLMTimeoutError,
  NotSupportedLLMError,
  LLMErrorCode,
  isRetryableLLMError,
} from '../../../src/agents/llm/errors.js';
import { ErrorCode } from '../../../src/core/errors/index.js';

describe('agents/llm - errors', () => {
  it('LLMError 应继承 AppError 并包含 llmCode', () => {
    const err = new LLMError({
      code: LLMErrorCode.INVALID_API_KEY,
      message: 'key 无效',
      provider: 'deepseek',
      model: 'deepseek-chat',
      httpStatus: 401,
      retryable: false,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LLMError');
    expect(err.llmCode).toBe(LLMErrorCode.INVALID_API_KEY);
    expect(err.provider).toBe('deepseek');
    expect(err.model).toBe('deepseek-chat');
    expect(err.httpStatus).toBe(401);
    expect(err.retryable).toBe(false);
    // 默认 statusCode 应反映 HTTP 状态
    expect(err.statusCode).toBe(401);
  });

  it('toJSON 应序列化 llm 字段', () => {
    const err = new LLMError({
      code: LLMErrorCode.RATE_LIMIT,
      message: 'rate limit',
      provider: 'openai',
      model: 'gpt-4o',
      httpStatus: 429,
      retryable: true,
    });
    const json = err.toJSON();
    expect(json.llmCode).toBe(LLMErrorCode.RATE_LIMIT);
    expect(json.provider).toBe('openai');
    expect(json.model).toBe('gpt-4o');
    expect(json.httpStatus).toBe(429);
    expect(json.retryable).toBe(true);
  });

  it('code 应映射到 ErrorCode.LLM_ERROR', () => {
    const err = new LLMError({ message: 'fail' });
    expect(err.code).toBe(ErrorCode.LLM_ERROR);
  });

  it('LLMTimeoutError 应可重试', () => {
    const err = new LLMTimeoutError('claude', 'claude-3-5-sonnet', 30_000);
    expect(err.name).toBe('LLMTimeoutError');
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('30000');
  });

  it('NotSupportedLLMError 应不可重试', () => {
    const err = new NotSupportedLLMError('embed', 'local', 'llama3');
    expect(err.name).toBe('NotSupportedLLMError');
    expect(err.retryable).toBe(false);
    expect(err.message).toContain('embed');
  });

  it('isRetryableLLMError 应正确判断', () => {
    const retryable = new LLMTimeoutError();
    const nonRetryable = new LLMError({ message: 'fail', retryable: false });
    expect(isRetryableLLMError(retryable)).toBe(true);
    expect(isRetryableLLMError(nonRetryable)).toBe(false);
    expect(isRetryableLLMError(new Error('plain'))).toBe(false);
    // AbortError 视为可重试
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(isRetryableLLMError(abortErr)).toBe(true);
  });
});