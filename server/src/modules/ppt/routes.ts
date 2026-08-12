/**
 * PPT 模块 HTTP 路由注册
 *
 * 端点：
 *   GET  /api/ppt/themes       - 列出所有主题
 *   GET  /api/ppt/templates    - 列出所有模板
 *   POST /api/ppt/make         - 生成 PPT，返回 pptx 二进制
 *
 * 与 server/src/gateway/server/http-routes.ts 的风格一致：
 *   - 复用 okResponse / errorResponse schema（Swagger 元数据）
 *   - 错误统一封装为 { ok: false, error: { code, message, retryable } }
 *   - 路由注册函数可独立调用，便于在测试中注入 mock module
 *
 * @module @myopenclaw/server/modules/ppt/routes
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PptModule } from './index.js';
import { PptError } from './index.js';
import { createLogger } from '../../core/utils/logger.js';

const log = createLogger('modules:ppt');

/** Swagger 200 响应 schema（供 /api/ppt/themes|templates 使用） */
const okResponse = {
  200: {
    description: '成功',
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      data: { type: 'object', additionalProperties: true },
    },
  },
};

/** Swagger 错误响应 schema */
const errorResponse = {
  description: 'Error',
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        retryable: { type: 'boolean' },
      },
    },
  },
};

/**
 * 把 PptError 映射为 HTTP 状态码
 *
 * 状态码策略：
 *   - PPT_INVALID_SPEC / PPT_UNKNOWN_THEME / PPT_UNKNOWN_TEMPLATE  -> 400
 *   - PPT_GENERATION_FAILED（retryable=true）                         -> 502
 *   - 其它                                                            -> 500
 *
 * @param err PptError 实例
 * @returns statusCode 和 body 片段
 */
function toApiError(err: PptError): {
  statusCode: number;
  body: { ok: false; error: { code: string; message: string; retryable: boolean } };
} {
  let statusCode = 500;
  if (
    err.code === 'PPT_INVALID_SPEC' ||
    err.code === 'PPT_UNKNOWN_THEME' ||
    err.code === 'PPT_UNKNOWN_TEMPLATE'
  ) {
    statusCode = 400;
  } else if (err.code === 'PPT_GENERATION_FAILED' && err.retryable) {
    statusCode = 502;
  }
  return {
    statusCode,
    body: {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        retryable: err.retryable,
      },
    },
  };
}

/**
 * 注册 PPT 模块 HTTP 路由
 *
 * 用法（在 gateway http-routes.ts 中）：
 *   import { createPptModule } from '../../modules/ppt/index.js';
 *   import { registerPptRoutes } from '../../modules/ppt/routes.js';
 *   const pptModule = await createPptModule();
 *   registerPptRoutes(fastify, pptModule);
 *
 * @param fastify Fastify 实例
 * @param pptModule PPT 模块实例（生产环境由 createPptModule() 构造，测试可注入 mock）
 */
export function registerPptRoutes(
  fastify: FastifyInstance,
  pptModule: PptModule,
): void {
  /* -------- GET /api/ppt/themes -------- */
  fastify.get('/api/ppt/themes', {
    schema: {
      description: '列出所有可用 PPT 主题（视觉风格 + 字体配对）',
      tags: ['PPT'],
      response: okResponse,
    },
  }, async () => ({
    ok: true,
    data: {
      total: (await pptModule.listThemes()).length,
      themes: await pptModule.listThemes(),
    },
  }));

  /* -------- GET /api/ppt/templates -------- */
  fastify.get('/api/ppt/templates', {
    schema: {
      description: '列出所有可用 PPT 模板（封面/目录/内容/分隔/结尾）',
      tags: ['PPT'],
      response: okResponse,
    },
  }, async () => ({
    ok: true,
    data: {
      total: (await pptModule.listTemplates()).length,
      templates: await pptModule.listTemplates(),
    },
  }));

  /* -------- POST /api/ppt/make -------- */
  fastify.post(
    '/api/ppt/make',
    {
      schema: {
        description: '根据 PptSpec 生成 PPT 文件，返回 application/vnd.openxmlformats-officedocument.presentationml.presentation',
        tags: ['PPT'],
        consumes: ['application/json'],
        produces: [
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        ],
        body: {
          type: 'object',
          required: ['theme', 'slides'],
          properties: {
            theme: { type: 'string', description: '主题 ID' },
            filename: { type: 'string', description: '文件名（不含扩展名）' },
            slides: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['template', 'title'],
                properties: {
                  template: {
                    type: 'string',
                    enum: ['cover', 'toc', 'content', 'divider', 'summary'],
                  },
                  title: { type: 'string' },
                  subtitle: { type: 'string' },
                  data: { type: 'object', additionalProperties: true },
                },
              },
            },
          },
        },
        response: {
          200: {
            description: '生成的 PPTX 二进制',
            type: 'string',
            format: 'binary',
          },
          400: errorResponse,
          500: errorResponse,
          502: errorResponse,
        },
      },
    },
    async (
      req: FastifyRequest<{
        Body: {
          theme: string;
          filename?: string;
          slides: Array<{
            template: 'cover' | 'toc' | 'content' | 'divider' | 'summary';
            title: string;
            subtitle?: string;
            data?: Record<string, unknown>;
          }>;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const startedAt = Date.now();
      try {
        const buffer = await pptModule.generatePptx(req.body);
        const filename = (req.body.filename || 'presentation').replace(
          /[^\w-]+/g,
          '_',
        );

        log.info(
          {
            filename,
            slideCount: req.body.slides.length,
            theme: req.body.theme,
            bytes: buffer.length,
            durationMs: Date.now() - startedAt,
          },
          'ppt generated',
        );

        return reply
          .code(200)
          .header(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          )
          .header(
            'Content-Disposition',
            `attachment; filename="${filename}.pptx"`,
          )
          .header('Content-Length', String(buffer.length))
          .send(buffer);
      } catch (err) {
        if (err instanceof PptError) {
          const { statusCode, body } = toApiError(err);
          log.warn(
            {
              code: err.code,
              message: err.message,
              durationMs: Date.now() - startedAt,
            },
            'ppt generation failed',
          );
          return reply.code(statusCode).send(body);
        }

        // 兜底：未预期的异常
        log.error(
          { err, durationMs: Date.now() - startedAt },
          'ppt unexpected error',
        );
        return reply.code(500).send({
          ok: false,
          error: {
            code: 'PPT_UNEXPECTED',
            message: err instanceof Error ? err.message : 'unknown',
            retryable: false,
          },
        });
      }
    },
  );
}
