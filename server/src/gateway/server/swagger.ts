/**
 * OpenAPI / Swagger 配置模块
 *
 * 定义网关 OpenAPI 文档的元信息，供 @fastify/swagger 和
 * @fastify/swagger-ui 插件使用。
 *
 * @module @myopenclaw/server/gateway/server
 */

import type { FastifyDynamicSwaggerOptions } from '@fastify/swagger';
import type { FastifySwaggerUiOptions } from '@fastify/swagger-ui';

/**
 * 构建 @fastify/swagger 插件配置（动态模式）
 */
export function buildSwaggerOptions(): FastifyDynamicSwaggerOptions {
  return {
    mode: 'dynamic',
    openapi: {
      info: {
        title: 'MyOpenClaw Gateway API',
        description:
          'MyOpenClaw 网关服务 REST API 文档。\n\n' +
          '提供健康检查、运行状态、连接管理、会话管理、' +
          'Agent 管理、Token 管理、审计日志查询、定时任务管理等接口。\n\n' +
          '认证方式: Bearer Token（Header: Authorization: Bearer <token>）\n\n' +
          'WebSocket 端点: `ws://{host}:{port}/ws`',
        version: '1.0.0',
      },
      servers: [
        {
          url: 'http://localhost:18780',
          description: '本地开发服务器',
        },
      ],
      tags: [
        { name: 'Health', description: '健康检查' } as const,
        { name: 'Status', description: '运行状态' } as const,
        { name: 'Connections', description: '连接管理' } as const,
        { name: 'Sessions', description: '会话管理' } as const,
        { name: 'Agents', description: 'Agent 管理' } as const,
        { name: 'Auth', description: '认证与 Token 管理' } as const,
        { name: 'Audit', description: '审计日志查询' } as const,
        { name: 'Scheduler', description: '定时任务管理' } as const,
      ],
      components: {
        schemas: {
          OkResponse: {
            type: 'object',
            properties: {
              ok: { type: 'boolean', description: '请求是否成功' },
              data: { type: 'object', additionalProperties: true, description: '响应数据' },
            },
          },
          ErrorResponse: {
            type: 'object',
            properties: {
              ok: { type: 'boolean', description: '始终为 false' },
              error: { type: 'string', description: '错误描述' },
            },
          },
        },
      },
    },
  };
}

/**
 * 构建 @fastify/swagger-ui 插件配置
 */
export function buildSwaggerUiOptions(): FastifySwaggerUiOptions {
  return {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list' as const,
      deepLinking: true,
      filter: true,
      tryItOutEnabled: true,
    },
    staticCSP: true,
  };
}
