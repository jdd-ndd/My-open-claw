/**
 * 限流中间件
 *
 * 使用 SecuritySandbox 的令牌桶算法对每个客户端进行速率限制，
 * 在 HTTP 响应头中添加限流信息。
 *
 * @module @myopenclaw/server/gateway/server/middleware
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { SecuritySandbox } from '../../security/index.js';
import { createLogger } from '../../../core/utils/logger.js';

const log = createLogger('gateway:middleware:rate-limit');

/**
 * 创建限流中间件
 *
 * 按客户端 IP 进行速率限制，触发时返回 429。
 */
export function createRateLimitMiddleware(sandbox: SecuritySandbox) {
  return async function rateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // 健康检查和文档端点跳过限流
    if (request.url.startsWith('/api/health') || request.url === '/docs' || request.url.startsWith('/docs/')) {
      return;
    }

    const clientId = request.ip ?? 'unknown';

    const result = sandbox.checkRateLimit(clientId);

    if (!result.passed) {
      log.warn({ clientId }, '限流触发: %s', result.reason);

      reply
        .code(429)
        .header('Retry-After', '30')
        .header('X-RateLimit-Limit', String(sandbox.getRateLimitConfig?.()?.rateLimit ?? 100))
        .header('X-RateLimit-Remaining', '0')
        .send({
          ok: false,
          error: {
            code: 400001,
            message: result.reason ?? '请求频率超限',
            retryable: true,
          },
        });
      return;
    }
  };
}
