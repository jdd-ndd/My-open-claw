/**
 * 认证中间件
 *
 * 从请求中提取 Bearer Token，调用 SecuritySandbox 进行校验，
 * 将 userId / scopes 注入 request 上下文供后续中间件和路由使用。
 *
 * @module @myopenclaw/server/gateway/server/middleware
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { SecuritySandbox } from '../../security/index.js';
import type { TokenService } from '../../security/token-service.js';
import { createLogger } from '../../../core/utils/logger.js';

const log = createLogger('gateway:middleware:auth');

/** 注入到 request 的认证信息 */
declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      userId: string;
      scopes: string[];
      tokenId: string;
    };
  }
}

/**
 * 创建认证中间件
 *
 * 从 Authorization header 或 query 参数获取 token 并校验。
 * 如果未配置 apiToken，跳过鉴权。
 */
export function createAuthMiddleware(
  sandbox: SecuritySandbox,
  tokenService: TokenService,
) {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // 健康检查端点跳过鉴权
    if (request.url.startsWith('/api/health') || request.url === '/docs' || request.url.startsWith('/docs/')) {
      return;
    }

    // 提取 token：优先 Header，其次 query 参数
    let token: string | undefined;

    const authHeader = request.headers.authorization;
    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        token = parts[1];
      }
    }

    if (!token) {
      const qToken = (request.query as Record<string, string>)?.token;
      if (qToken) token = qToken;
    }

    // 调用 SecuritySandbox 进行基础鉴权
    const result = sandbox.authenticate(token);

    if (!result.passed) {
      log.warn({ ip: request.ip }, '认证失败: %s', result.reason);
      reply.code(401).send({
        ok: false,
        error: {
          code: 300001,
          message: result.reason ?? '未认证',
          retryable: false,
        },
      });
      return;
    }

    // 如果配置了 TokenService，进行 JWT 验证并注入上下文
    if (token && tokenService) {
      try {
        const payload = tokenService.verify(token);
        request.auth = {
          userId: payload.sub,
          scopes: payload.scope ?? [],
          tokenId: payload.jti ?? '',
        };
      } catch (err) {
        log.warn({ ip: request.ip, error: (err as Error).message }, 'Token 验证失败');
        reply.code(401).send({
          ok: false,
          error: {
            code: 300004,
            message: 'Token 无效',
            retryable: false,
          },
        });
        return;
      }
    } else {
      // 无 JWT 时（apiToken 为空），使用默认身份
      request.auth = {
        userId: 'admin',
        scopes: ['admin'],
        tokenId: 'default',
      };
    }
  };
}

/**
 * 创建可选的认证中间件（认证失败不放行，但不认证也无妨的端点用）
 */
export function createOptionalAuthMiddleware(
  sandbox: SecuritySandbox,
  tokenService: TokenService,
) {
  return async function optionalAuthMiddleware(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const authHeader = request.headers.authorization;
    if (!authHeader) return;

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return;

    const token = parts[1];
    const result = sandbox.authenticate(token);
    if (!result.passed) return;

    try {
      const payload = tokenService.verify(token);
      request.auth = {
        userId: payload.sub,
        scopes: payload.scope ?? [],
        tokenId: payload.jti ?? '',
      };
    } catch {
      // 可选认证失败不中断
    }
  };
}

/**
 * 创建 Scope 权限校验中间件工厂
 *
 * @param requiredScope - 该路由所需的权限
 */
export function requireScope(requiredScope: string) {
  return async function scopeMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const auth = request.auth;
    if (!auth) {
      reply.code(401).send({
        ok: false,
        error: { code: 300001, message: '未认证', retryable: false },
      });
      return;
    }

    const hasScope =
      auth.scopes.includes('admin') || auth.scopes.includes(requiredScope);

    if (!hasScope) {
      log.warn(
        { userId: auth.userId, required: requiredScope, actual: auth.scopes },
        '权限不足',
      );
      reply.code(403).send({
        ok: false,
        error: {
          code: 300002,
          message: `权限不足，需要: ${requiredScope}`,
          retryable: false,
        },
      });
      return;
    }
  };
}
