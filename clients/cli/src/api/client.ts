/**
 * Gateway HTTP API 客户端
 *
 * 基于 axios 封装的 HTTP 客户端，提供统一的 API 调用接口。
 * 处理 Gateway 的 { ok: true, data } / { ok: false, error } 响应格式，
 * 自动解包数据并处理错误，使上层命令代码可以直接使用业务数据。
 *
 * @module cli/api
 */

import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import type { ApiResponse, ApiError } from './types.js';

/**
 * Gateway HTTP 客户端配置
 */
export interface GatewayClientConfig {
  /** Gateway HTTP 基础地址 */
  baseURL: string;
  /** 请求超时时间（毫秒） */
  timeout?: number;
  /** 是否启用详细日志 */
  verbose?: boolean;
}

/**
 * Gateway API 错误异常
 *
 * 当 Gateway 返回错误响应时抛出此异常，包含详细的错误信息。
 */
export class GatewayApiError extends Error {
  /** 错误代码 */
  public code: number;
  /** 是否可重试 */
  public retryable: boolean;
  /** HTTP 状态码 */
  public statusCode: number;

  constructor(error: ApiError, statusCode: number = 0) {
    super(error.message);
    this.name = 'GatewayApiError';
    this.code = error.code;
    this.retryable = error.retryable;
    this.statusCode = statusCode;
  }
}

/**
 * 创建 Gateway HTTP 客户端实例
 *
 * 创建配置好的 axios 实例，包含：
 * - 统一的请求头设置
 * - 请求日志拦截器
 * - 响应解包逻辑（自动处理 { ok, data } 格式）
 * - 统一的错误处理
 *
 * @param config - 客户端配置
 * @returns 配置好的 axios 实例
 */
export function createGatewayClient(config: GatewayClientConfig): AxiosInstance {
  const client = axios.create({
    baseURL: config.baseURL.replace(/\/$/, ''),
    timeout: config.timeout || 30000,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'myopenclaw-cli/1.1.0',
    },
  });

  // 请求拦截器：添加请求日志
  client.interceptors.request.use(
    (request) => {
      if (config.verbose) {
        const method = request.method?.toUpperCase() || 'GET';
        const url = request.url || '';
        const timestamp = new Date().toISOString();
        console.error(`[${timestamp}] HTTP ${method} ${config.baseURL}${url}`);
        if (request.params) {
          console.error(`  params: ${JSON.stringify(request.params)}`);
        }
        if (request.data && config.verbose) {
          console.error(`  body: ${JSON.stringify(request.data).slice(0, 200)}`);
        }
      }
      return request;
    },
    (error) => Promise.reject(error)
  );

  // 响应拦截器：处理 Gateway 的 { ok, data } 格式
  client.interceptors.response.use(
    (response: AxiosResponse<ApiResponse>) => {
      const body = response.data;

      // Gateway 统一响应格式：{ ok, data } 或 { ok, error }
      if (body && typeof body === 'object' && 'ok' in body) {
        if (body.ok) {
          // 成功：返回 data 部分
          return body.data as AxiosResponse;
        } else if (body.error) {
          // 业务错误：抛出 GatewayApiError
          throw new GatewayApiError(body.error, response.status);
        }
      }

      // 非标准响应（可能直接返回数据），直接返回
      return body as unknown as AxiosResponse;
    },
    (error) => {
      // 网络错误或 HTTP 错误
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data as ApiResponse | undefined;

        // 尝试从响应体中提取错误信息
        if (data?.error) {
          return Promise.reject(new GatewayApiError(data.error, status));
        }

        // HTTP 状态码对应的友好错误消息
        const statusMessages: Record<number, string> = {
          400: '请求参数错误',
          401: '未授权，请检查认证信息',
          403: '访问被拒绝',
          404: `Gateway 端点不存在: ${error.config?.url}`,
          429: '请求过于频繁，请稍后重试',
          500: 'Gateway 内部服务器错误',
          502: '网关错误',
          503: 'Gateway 服务不可用，请检查服务是否启动',
          504: '网关注入超时',
        };

        const message = statusMessages[status] || `HTTP ${status}: ${error.message}`;
        return Promise.reject(new GatewayApiError(
          { code: status, message, retryable: status >= 500 },
          status
        ));
      }

      // 网络连接错误
      if (error.code === 'ECONNREFUSED') {
        return Promise.reject(new GatewayApiError(
          { code: 300001, message: `无法连接到 Gateway: ${config.baseURL}，请检查服务是否启动`, retryable: true },
          0
        ));
      }

      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        return Promise.reject(new GatewayApiError(
          { code: 300002, message: `请求超时，请检查网络连接或增加超时时间`, retryable: true },
          0
        ));
      }

      // 其他未知错误
      return Promise.reject(new GatewayApiError(
        { code: 100000, message: error.message || '未知错误', retryable: false },
        0
      ));
    }
  );

  return client;
}

/**
 * 健康检查 API
 *
 * 调用 Gateway 健康检查端点，验证服务是否正常运行。
 *
 * @param client - HTTP 客户端实例
 * @returns 健康检查结果
 */
export async function checkHealth<T = unknown>(client: AxiosInstance): Promise<T> {
  const response = await client.get<unknown, T>('/api/health');
  return response;
}

/**
 * 获取系统状态
 *
 * 调用 Gateway 状态端点获取当前运行状态信息。
 *
 * @param client - HTTP 客户端实例
 * @returns 系统状态数据
 */
export async function getSystemStatus<T = unknown>(client: AxiosInstance): Promise<T> {
  const response = await client.get<unknown, T>('/api/status');
  return response;
}

/**
 * 获取会话列表
 *
 * @param client - HTTP 客户端实例
 * @param params - 查询参数
 * @returns 会话列表
 */
export async function getSessions<T = unknown>(
  client: AxiosInstance,
  params?: Record<string, unknown>
): Promise<T> {
  const response = await client.get<unknown, T>('/api/sessions', { params });
  return response;
}

/**
 * 创建会话
 *
 * @param client - HTTP 客户端实例
 * @param data - 会话创建数据
 * @returns 创建的会话信息
 */
export async function createSession<T = unknown>(
  client: AxiosInstance,
  data: Record<string, unknown>
): Promise<T> {
  const response = await client.post<unknown, T>('/api/sessions', data);
  return response;
}

/**
 * 获取会话详情
 *
 * @param client - HTTP 客户端实例
 * @param sessionId - 会话 ID
 * @returns 会话详情
 */
export async function getSession<T = unknown>(
  client: AxiosInstance,
  sessionId: string
): Promise<T> {
  const response = await client.get<unknown, T>(`/api/sessions/${sessionId}`);
  return response;
}

/**
 * 删除会话
 *
 * @param client - HTTP 客户端实例
 * @param sessionId - 会话 ID
 */
export async function deleteSession(
  client: AxiosInstance,
  sessionId: string
): Promise<void> {
  await client.delete(`/api/sessions/${sessionId}`);
}

/**
 * 获取 Agent 列表
 *
 * @param client - HTTP 客户端实例
 * @returns Agent 列表
 */
export async function getAgents<T = unknown>(client: AxiosInstance): Promise<T> {
  const response = await client.get<unknown, T>('/api/agents');
  return response;
}

/**
 * 获取审计日志
 *
 * @param client - HTTP 客户端实例
 * @param params - 查询参数
 * @returns 审计日志
 */
export async function getAuditLogs<T = unknown>(
  client: AxiosInstance,
  params?: Record<string, unknown>
): Promise<T> {
  const response = await client.get<unknown, T>('/api/audit', { params });
  return response;
}

/**
 * 获取调度器任务列表
 *
 * @param client - HTTP 客户端实例
 * @returns 任务列表
 */
export async function getSchedulerTasks<T = unknown>(client: AxiosInstance): Promise<T> {
  const response = await client.get<unknown, T>('/api/scheduler/tasks');
  return response;
}

/**
 * 获取工具列表
 *
 * 调用 /api/tools 端点，从 Gateway 拉取当前已注册的工具清单。
 * 支持按分类、风险等级、是否内置工具过滤。
 *
 * @param client - HTTP 客户端实例
 * @param params - 可选过滤参数（category / risk / builtinOnly）
 * @returns 工具列表响应
 */
export async function getTools<T = unknown>(
  client: AxiosInstance,
  params?: { category?: string; risk?: string; builtinOnly?: boolean }
): Promise<T> {
  const response = await client.get<unknown, T>('/api/tools', { params });
  return response;
}

/**
 * 获取技能列表
 *
 * 调用 /api/skills 端点，从 Gateway 拉取当前已注册的技能清单。
 *
 * @param client - HTTP 客户端实例
 * @returns 技能列表响应
 */
export async function getSkills<T = unknown>(client: AxiosInstance): Promise<T> {
  const response = await client.get<unknown, T>('/api/skills');
  return response;
}

/**
 * 检查错误是否为 Gateway API 错误
 *
 * @param error - 未知错误对象
 * @returns 是否为 GatewayApiError 类型
 */
export function isGatewayApiError(error: unknown): error is GatewayApiError {
  return error instanceof GatewayApiError;
}

/**
 * 格式化 HTTP 请求参数
 *
 * 将对象转换为 URL 查询字符串，处理特殊字符编码。
 *
 * @param params - 参数对象
 * @returns 格式化后的查询字符串
 */
export function formatQueryString(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}
