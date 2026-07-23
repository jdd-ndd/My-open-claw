/**
 * HTTP REST 路由注册模块
 *
 * 负责向 Fastify 实例注册网关暴露的 HTTP 接口，
 * 包括健康检查、运行状态、连接列表、会话列表等。
 *
 * @module @myopenclaw/server/gateway/server
 */

import type { FastifyInstance } from 'fastify';
import { createLogger } from '../../core/utils/logger.js';
import type { ConnectionStore } from './connection-store.js';
import type { MessageRouter } from '../router/index.js';
import type { GatewayServerConfig } from './types.js';

const log = createLogger('gateway:http-routes');

/**
 * 统一 JSON 响应 schema（data 允许附加属性）
 */
const okSchema = {
  type: 'object' as const,
  properties: {
    ok: { type: 'boolean' as const },
    data: { type: 'object' as const, additionalProperties: true as const },
  },
};

/**
 * 注册所有 HTTP REST 路由
 *
 * @param fastify Fastify 实例
 * @param store 连接存储实例
 * @param router 消息路由器实例
 * @param config 网关服务器配置
 */
export function registerHttpRoutes(
  fastify: FastifyInstance,
  store: ConnectionStore,
  router: MessageRouter,
  config: GatewayServerConfig
): void {
  // GET /api/health — 健康检查
  fastify.get('/api/health', { schema: { response: { 200: okSchema } } }, async () => {
    return { ok: true, data: { status: 'healthy' as const } };
  });

  // GET /api/status — 网关运行状态
  fastify.get('/api/status', { schema: { response: { 200: okSchema } } }, async () => {
    return {
      ok: true,
      data: {
        status: 'running' as const,
        uptime: process.uptime(),
        connectionCount: store.size,
        maxConnections: config.maxConnections,
        activeSessions: router.activeSessionCount,
        ruleCount: router.getRules().length,
        host: config.host,
        port: config.port,
      },
    };
  });

  // GET /api/connections — 当前连接列表
  fastify.get('/api/connections', async () => {
    const list = store.getMetadataList();
    return { ok: true, data: { total: list.length, connections: list } };
  });

  // GET /api/sessions — 在线会话列表
  fastify.get('/api/sessions', async () => {
    const rules = router.getRules();
    return {
      ok: true,
      data: {
        activeSessionCount: router.activeSessionCount,
        ruleCount: rules.length,
        rules: rules.map((r) => ({
          id: r.id,
          priority: r.priority,
          channelId: r.channelId,
          agentId: r.agentId,
          enabled: r.enabled,
        })),
      },
    };
  });

  // 404 fallback
  fastify.setNotFoundHandler(async (_request, reply) => {
    reply.code(404).send({ ok: false, error: 'Not found' });
  });

  // 全局错误处理
  fastify.setErrorHandler(async (err, _request, reply) => {
    const error = err as { statusCode?: number; message: string };
    log.error({ error: error.message }, 'HTTP 全局错误');
    reply.code(error.statusCode ?? 500).send({
      ok: false,
      error: error.message,
    });
  });
}
