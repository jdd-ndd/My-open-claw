/**
 * 网络请求工具集（对齐文档 §4.5）
 *
 * 提供 HTTP API 调用能力，支持 GET、POST、PUT、DELETE 等方法。
 *
 * @module @myopenclaw/server/tools/http
 */

import { createLogger } from '../../core/utils/logger.js';
import type { Tool, ToolResult, InvokeContext, JSONSchema } from '../../core/types/index.js';

const log = createLogger('tools:http');

// ═══════════════════════════════════════════════════════════════
// http/request —— HTTP 请求（对齐文档 §4.5）
// ═══════════════════════════════════════════════════════════════

export class HttpRequestTool implements Tool {
  readonly name = 'http/request';
  readonly description = '发起 HTTP 请求。支持 GET/POST/PUT/DELETE/PATCH 方法，可设置请求头、请求体、超时。';
  readonly category = 'http';
  readonly risk: 'low' | 'medium' | 'high' = 'medium';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      url: { type: 'string', description: '请求 URL' },
      method: {
        type: 'string',
        description: 'HTTP 方法',
        enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'],
        default: 'GET',
      },
      headers: {
        type: 'object',
        description: '请求头键值对',
        additionalProperties: { type: 'string' },
      },
      body: {
        type: 'string',
        description: '请求体内容（JSON 字符串或纯文本）',
      },
      contentType: {
        type: 'string',
        description: '内容类型',
        enum: ['application/json', 'application/x-www-form-urlencoded', 'text/plain'],
        default: 'application/json',
      },
      timeout: {
        type: 'number',
        description: '请求超时（毫秒），默认 30000',
        default: 30000,
      },
      followRedirects: {
        type: 'boolean',
        description: '是否跟随重定向',
        default: true,
      },
    },
    required: ['url'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startTime = Date.now();
    const url = String(params.url);
    const method = (params.method as string) ?? 'GET';
    const headers = (params.headers as Record<string, string>) ?? {};
    const body = params.body as string | undefined;
    const contentType = (params.contentType as string) ?? 'application/json';
    const timeout = (params.timeout as number) ?? 30000;
    const followRedirects = (params.followRedirects as boolean) ?? true;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const fetchOptions: RequestInit = {
        method,
        headers: {
          'Content-Type': contentType,
          'User-Agent': 'MyOpenClaw/1.0',
          ...headers,
        },
        signal: controller.signal,
        redirect: followRedirects ? 'follow' : 'manual',
      };

      // 仅在有 body 且方法支持时添加 body
      if (body && !['GET', 'HEAD'].includes(method.toUpperCase())) {
        fetchOptions.body = body;
      }

      const response = await fetch(url, fetchOptions);
      clearTimeout(timer);

      // 读取响应体
      const responseText = await response.text();
      let parsedBody: unknown = responseText;

      // 尝试解析 JSON
      try {
        parsedBody = JSON.parse(responseText);
      } catch {
        // 保持为文本
      }

      log.info({ method, url, status: response.status, durationMs: Date.now() - startTime }, 'HTTP 请求完成');

      return {
        success: response.ok,
        status: response.ok ? 'success' : 'error',
        data: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: parsedBody,
        },
        error: !response.ok ? `HTTP ${response.status}: ${response.statusText}` : undefined,
        metadata: {
          durationMs: Date.now() - startTime,
          sideEffects: [],
          resources: {
            responseSize: responseText.length,
            status: response.status,
          },
        },
      };
    } catch (err) {
      const errorMsg = (err as Error).message;
      const isTimeout = errorMsg.includes('aborted') || errorMsg.includes('timeout');

      log.error({ method, url, err: errorMsg }, 'HTTP 请求失败');

      return {
        success: false,
        status: isTimeout ? 'timeout' : 'error',
        error: isTimeout ? `请求超时（${timeout}ms）` : `HTTP 请求失败: ${errorMsg}`,
        errorCode: isTimeout ? 'HTTP_TIMEOUT' : 'HTTP_ERROR',
        metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 旧版 HttpTool（向后兼容）
// ═══════════════════════════════════════════════════════════════

/**
 * 旧版 HTTP 工具（兼容接口）
 *
 * @deprecated 请使用 HttpRequestTool 替代
 */
export class HttpTool implements Tool {
  readonly name = 'http';
  readonly description = '发起 HTTP 请求（GET/POST/PUT/DELETE）—— 已废弃，请使用 http/request';
  readonly category = 'http';
  readonly risk: 'low' | 'medium' | 'high' = 'medium';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      method: { type: 'string', description: 'HTTP 方法', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
      url: { type: 'string', description: '请求 URL' },
      headers: { type: 'object', description: '请求头' },
      body: { type: 'string', description: '请求体' },
    },
    required: ['method', 'url'],
  };

  async execute(params: Record<string, unknown>, context: InvokeContext): Promise<ToolResult> {
    const delegate = new HttpRequestTool();
    return delegate.execute(params, context);
  }
}
