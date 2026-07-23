/**
 * Core Errors 单元测试
 */
import { describe, it, expect } from 'vitest';
import { ErrorCode, AppError } from '../../../src/core/errors/index.js';
import {
  validationError,
  unauthorizedError,
  notFoundError,
  forbiddenError,
  timeoutError,
} from '../../../src/core/errors/index.js';

describe('Core - Errors', () => {
  describe('ErrorCode', () => {
    it('应有正确的6位数字错误码分段', () => {
      // 通用错误 (100xxx)
      expect(ErrorCode.UNKNOWN).toBe(100000);
      expect(ErrorCode.INTERNAL).toBe(100001);
      expect(ErrorCode.TIMEOUT).toBe(100004);

      // 校验错误 (200xxx)
      expect(ErrorCode.VALIDATION).toBe(200001);
      expect(ErrorCode.INVALID_FORMAT).toBe(200002);

      // 鉴权错误 (300xxx)
      expect(ErrorCode.UNAUTHORIZED).toBe(300001);
      expect(ErrorCode.FORBIDDEN).toBe(300002);

      // 限流错误 (400xxx)
      expect(ErrorCode.RATE_LIMIT).toBe(400001);

      // 会话/任务错误 (500xxx)
      expect(ErrorCode.SESSION_NOT_FOUND).toBe(500001);
      expect(ErrorCode.TASK_NOT_FOUND).toBe(500005);

      // 工具错误 (600xxx)
      expect(ErrorCode.TOOL_NOT_FOUND).toBe(600001);
      expect(ErrorCode.TOOL_EXECUTION_FAILED).toBe(600002);

      // LLM 错误 (700xxx)
      expect(ErrorCode.LLM_ERROR).toBe(700001);
      expect(ErrorCode.LLM_TIMEOUT).toBe(700002);

      // 记忆错误 (800xxx)
      expect(ErrorCode.MEMORY_ERROR).toBe(800001);

      // 渠道错误 (900xxx)
      expect(ErrorCode.CHANNEL_ERROR).toBe(900001);
      expect(ErrorCode.CHANNEL_DISCONNECTED).toBe(900002);
    });
  });

  describe('AppError', () => {
    it('应正确创建 AppError 实例', () => {
      const err = new AppError({
        code: ErrorCode.VALIDATION,
        message: '校验失败',
        statusCode: 400,
        details: [{ field: 'email', message: '格式无效' }],
      });

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AppError);
      expect(err.name).toBe('AppError');
      expect(err.code).toBe(200001);
      expect(err.statusCode).toBe(400);
      expect(err.retryable).toBe(false);
      expect(err.details).toHaveLength(1);
    });

    it('toJSON 应返回正确的序列化格式', () => {
      const err = new AppError({
        code: ErrorCode.TIMEOUT,
        message: '超时',
        retryable: true,
      });

      const json = err.toJSON();
      expect(json.code).toBe(100004);
      expect(json.message).toBe('超时');
      expect(json.retryable).toBe(true);
    });

    it('默认 statusCode 应为 500', () => {
      const err = new AppError({ code: ErrorCode.INTERNAL, message: '未知错误' });
      expect(err.statusCode).toBe(500);
    });

    it('cause 应正确传递', () => {
      const original = new Error('原始错误');
      const err = new AppError({
        code: ErrorCode.INTERNAL,
        message: '包装错误',
        cause: original,
      });
      expect(err.cause).toBe(original);
    });
  });

  describe('错误工厂函数', () => {
    it('validationError 应创建校验错误', () => {
      const err = validationError('字段无效', [{ field: 'name', message: '必填' }]);
      expect(err.code).toBe(ErrorCode.VALIDATION);
      expect(err.statusCode).toBe(400);
      expect(err.retryable).toBe(false);
      expect(err.details).toHaveLength(1);
    });

    it('unauthorizedError 应创建未认证错误', () => {
      const err = unauthorizedError();
      expect(err.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('未认证');
    });

    it('notFoundError 应创建 404 错误', () => {
      const err = notFoundError(ErrorCode.SESSION_NOT_FOUND, '会话不存在');
      expect(err.code).toBe(500001);
      expect(err.statusCode).toBe(404);
      expect(err.retryable).toBe(false);
    });

    it('forbiddenError 应创建禁止访问错误', () => {
      const err = forbiddenError('权限不足');
      expect(err.code).toBe(ErrorCode.FORBIDDEN);
      expect(err.statusCode).toBe(403);
    });

    it('timeoutError 应创建可重试的超时错误', () => {
      const err = timeoutError('请求超时');
      expect(err.code).toBe(ErrorCode.TIMEOUT);
      expect(err.statusCode).toBe(504);
      expect(err.retryable).toBe(true);
    });
  });
});
