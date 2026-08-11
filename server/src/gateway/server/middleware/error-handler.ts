/**
 * 统一错误处理中间件
 */

import type { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import type { AuditLogger } from '../../audit/index.js';
import { createLogger } from '../../../core/utils/logger.js';

const log = createLogger('gateway:middleware:error-handler');

interface ErrorResponse {
  ok: false;
  error: {
    code: number;
    message: string;
    details?: Array<{ field: string; message: string }>;
    retryable: boolean;
  };
}

export function registerErrorHandler(
  fastify: FastifyInstance,
  audit?: AuditLogger,
): void {
  fastify.setErrorHandler((err: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const appError = extractAppError(err);
    const statusCode = determineHttpStatus(err, appError);

    const body: ErrorResponse = {
      ok: false,
      error: {
        code: appError.code ?? 100001,
        message: appError.message ?? err.message ?? '内部服务错误',
        retryable: appError.retryable ?? isRetryable(statusCode),
      },
    };

    if (appError.details) {
      body.error.details = appError.details;
    }

    if (audit) {
      audit.logEntry({
        category: 'system',
        event: 'gateway.error',
        details: {
          method: request.method,
          url: request.url,
          statusCode,
          errorCode: body.error.code,
          errorMessage: body.error.message,
        },
        success: false,
        error: body.error.message,
        sourceIp: request.ip,
      });
    }

    log.error(
      {
        method: request.method,
        url: request.url,
        statusCode,
        errorCode: body.error.code,
        error: body.error.message,
      },
      'HTTP 请求错误',
    );

    reply.code(statusCode).send(body);
  });
}

function extractAppError(err: FastifyError): {
  code?: number;
  message?: string;
  details?: Array<{ field: string; message: string }>;
  retryable?: boolean;
} {
  const appErr = err as FastifyError & {
    code?: number;
    details?: Array<{ field: string; message: string }>;
    retryable?: boolean;
  };

  if (appErr.code) {
    return {
      code: appErr.code,
      message: appErr.message,
      details: appErr.details,
      retryable: appErr.retryable,
    };
  }

  if (err.validation) {
    const details = err.validation.map((v) => ({
      field: v.keyword === 'required' ? String((v.params as Record<string, unknown>)?.missingProperty ?? '') : '',
      message: v.message ?? 'Validation error',
    }));

    return {
      code: 200001,
      message: '数据校验失败',
      details,
      retryable: false,
    };
  }

  return {};
}

function determineHttpStatus(
  err: FastifyError,
  appError: { code?: number },
): number {
  if (err.statusCode && err.statusCode >= 400) {
    return err.statusCode;
  }

  if (appError.code) {
    const code = appError.code;
    if (code >= 300001 && code < 400000) return 401;
    if (code === 200001) return 400;
    if (code === 400001 || code === 400003) return 429;
    if (code === 500001) return 404;
    if (code === 500002) return 409;
    if (code >= 600000) return 500;
    if (code >= 700001 && code <= 700003) return 502;
    if (code === 100004 || code === 600003) return 504;
    if (code === 100003) return 503;
  }

  return 500;
}

function isRetryable(statusCode: number): boolean {
  return [429, 502, 503, 504].includes(statusCode);
}
