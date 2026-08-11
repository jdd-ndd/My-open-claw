/**
 * 请求/响应日志中间件
 *
 * 在每个 HTTP 请求完成时记录审计日志，
 * 包括方法、URL、状态码、耗时、用户信息。
 *
 * @module @myopenclaw/server/gateway/server/middleware
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuditLogger } from '../../audit/index.js';
import { createLogger } from '../../../core/utils/logger.js';

const log = createLogger('gateway:middleware:logging');

/**
 * 创建请求日志中间件
 *
 * 在 onResponse 钩子中记录请求信息。
 */
export function createLoggingMiddleware(audit: AuditLogger) {
  return async function loggingMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const startTime = Date.now();

    // 在响应完成后记录日志
    reply.then(
      () => {
        const duration = Date.now() - startTime;
        const statusCode = reply.statusCode;
        const success = statusCode >= 200 && statusCode < 400;

        audit.logEntry({
          category: 'message',
          event: 'http.request',
          channelId: 'http',
          userId: request.auth?.userId,
          details: {
            method: request.method,
            url: request.url,
            statusCode,
            duration,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
          },
          duration,
          success,
          sourceIp: request.ip,
        });

        log.debug(
          { method: request.method, url: request.url, statusCode, duration },
          'HTTP 请求完成',
        );
      },
      () => {
        // 响应失败（如连接中断）也记录
        const duration = Date.now() - startTime;
        audit.logEntry({
          category: 'message',
          event: 'http.error',
          channelId: 'http',
          details: {
            method: request.method,
            url: request.url,
            duration,
            ip: request.ip,
          },
          duration,
          success: false,
          error: '响应处理失败',
        });
      },
    );
  };
}
