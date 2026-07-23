/**
 * 统一应用错误类
 *
 * 所有业务错误都应抛出 AppError 或其子类，避免抛出原始 Error。
 *
 * @module @myopenclaw/server/core/errors
 */

import { ErrorCode } from './codes.js';

export interface AppErrorParams {
  code: number;
  message: string;
  statusCode?: number;
  details?: Array<{ field: string; message: string }>;
  cause?: unknown;
  retryable?: boolean;
}

export class AppError extends Error {
  readonly code: number;
  readonly statusCode: number;
  readonly details?: Array<{ field: string; message: string }>;
  readonly cause?: unknown;
  readonly retryable: boolean;

  constructor(params: AppErrorParams) {
    super(params.message);
    this.name = 'AppError';
    this.code = params.code;
    this.statusCode = params.statusCode ?? 500;
    this.details = params.details;
    this.cause = params.cause;
    this.retryable = params.retryable ?? false;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
    };
  }
}

/** 校验错误工厂 */
export function validationError(
  message: string,
  details: Array<{ field: string; message: string }>,
): AppError {
  return new AppError({
    code: ErrorCode.VALIDATION,
    message,
    statusCode: 400,
    details,
    retryable: false,
  });
}

/** 未认证错误工厂 */
export function unauthorizedError(message = '未认证'): AppError {
  return new AppError({
    code: ErrorCode.UNAUTHORIZED,
    message,
    statusCode: 401,
    retryable: false,
  });
}

/** 未找到错误工厂 */
export function notFoundError(code: number, message: string): AppError {
  return new AppError({ code, message, statusCode: 404, retryable: false });
}

/** 禁止访问错误工厂 */
export function forbiddenError(message: string): AppError {
  return new AppError({
    code: ErrorCode.FORBIDDEN,
    message,
    statusCode: 403,
    retryable: false,
  });
}

/** 超时错误工厂 */
export function timeoutError(message: string): AppError {
  return new AppError({
    code: ErrorCode.TIMEOUT,
    message,
    statusCode: 504,
    retryable: true,
  });
}
