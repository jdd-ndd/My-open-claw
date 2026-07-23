/**
 * Gateway 网关服务 —— GatewayServer
 *
 * 基于 Fastify（HTTP）+ @fastify/websocket（WebSocket）双协议的网关服务器。
 * 负责管理 WebSocket 客户端连接、接收/分发消息、心跳保活、
 * 健康检查，并内置 MessageRouter 进行消息路由。
 *
 * 本文件为 orchestration 层，通过组合以下单一职责模块完成网关功能：
 * - {@link ConnectionStore} 连接与元数据存储
 * - {@link createMessenger} 消息发送与广播
 * - {@link registerHttpRoutes} HTTP 路由注册
 * - {@link handleConnection} WebSocket 连接与消息处理
 * - {@link startHeartbeat} / {@link stopHeartbeat} 心跳保活
 *
 * Fastify 带来以下能力：
 * - 结构化路由（schema-based validation）
 * - CORS / Compression 插件开箱即用
 * - 请求/响应日志
 * - 优雅关闭（graceful shutdown）
 *
 * @module @myopenclaw/server/gateway
 */

import { EventEmitter } from 'node:events';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyCompress from '@fastify/compress';
import { createLogger } from '../../core/utils/logger.js';
import { MessageRouter } from '../router/index.js';
import { ConnectionStore } from './connection-store.js';
import { createMessenger } from './messaging.js';
import { registerHttpRoutes } from './http-routes.js';
import { handleConnection } from './websocket-handler.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import type { GatewayServerConfig } from './types.js';
import type { GatewayMessage, ResponseMessage, EventMessage } from '../protocol.js';

const log = createLogger('gateway:server');

// 默认常量
const DEFAULT_MAX_MESSAGE_SIZE = 500 * 1024;
const DEFAULT_WS_MAX_PAYLOAD = 1 * 1024 * 1024;

export type { GatewayServerConfig } from './types.js';

/**
 * 网关服务器
 *
 * 继承 EventEmitter，发出以下事件：
 * - {@event started}  : 服务器启动完成 (config)
 * - {@event stopped}  : 服务器已停止
 * - {@event connection}   : 新 WS 客户端连接 (connectionId)
 * - {@event disconnection}: WS 客户端断开 (connectionId, code, reason)
 * - {@event message}      : 收到客户端消息 (connectionId, message)
 * - {@event error}        : 发生错误 (connectionId, Error)
 */
export class GatewayServer extends EventEmitter {
  /** 网关配置 */
  readonly config: GatewayServerConfig;

  /** Fastify 应用实例 */
  private fastify: FastifyInstance | null = null;

  /** 消息路由器实例 */
  readonly router: MessageRouter;

  /** 连接存储 */
  private readonly store: ConnectionStore;

  /** 消息发送器 */
  private readonly messenger: ReturnType<typeof createMessenger>;

  /** 心跳定时器引用 */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<GatewayServerConfig>) {
    super();
    this.setMaxListeners(100);

    this.config = {
      host: config?.host ?? '127.0.0.1',
      port: config?.port ?? 18780,
      heartbeatInterval: config?.heartbeatInterval ?? 30_000,
      maxConnections: config?.maxConnections ?? 1_000,
      requestTimeout: config?.requestTimeout ?? 30_000,
    };

    this.router = new MessageRouter();
    this.router.initDatabase();

    this.store = new ConnectionStore();
    this.messenger = createMessenger(this.store);
  }

  /**
   * 启动网关服务器
   *
   * 1. 创建 Fastify 实例并注册插件（CORS / Compression / WebSocket）
   * 2. 注册 HTTP 路由（health / status / connections / sessions）
   * 3. 注册 WebSocket handler
   * 4. 监听端口
   * 5. 启动心跳定时器
   */
  async start(): Promise<void> {
    log.info({ host: this.config.host, port: this.config.port }, 'GatewayServer 正在启动...');

    // ① 创建 Fastify
    this.fastify = Fastify({
      logger: false, // 使用 pino 统一日志
      requestTimeout: this.config.requestTimeout,
      maxParamLength: 200,
    });

    // ② 注册插件
    await this.fastify.register(fastifyCors, {
      origin: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    });

    await this.fastify.register(fastifyCompress, {
      global: true,
      threshold: 1024,
    });

    await this.fastify.register(fastifyWebsocket, {
      options: { maxPayload: DEFAULT_WS_MAX_PAYLOAD }, // 1MB max message
    });

    // ③ 注册 HTTP 路由
    registerHttpRoutes(this.fastify, this.store, this.router, this.config);

    // ④ 注册 WebSocket 路由
    const wsDeps = {
      store: this.store,
      router: this.router,
      maxMessageSize: DEFAULT_MAX_MESSAGE_SIZE,
      emitter: this as EventEmitter,
      messenger: this.messenger,
      maxConnections: this.config.maxConnections,
    };

    this.fastify.register(async (scope) => {
      scope.get('/ws', { websocket: true }, (socket) => {
        handleConnection(socket, wsDeps);
      });
    });

    // ⑤ 监听
    await this.fastify.listen({
      host: this.config.host,
      port: this.config.port,
    });

    // ⑥ 启动心跳
    this.heartbeatTimer = startHeartbeat(this.store, this.config.heartbeatInterval);

    log.info({ host: this.config.host, port: this.config.port }, 'GatewayServer 启动完成');
    this.emit('started', this.config);
  }

  /**
   * 停止网关服务器
   *
   * 依次：清除心跳 → 关闭所有连接 → 关闭 Fastify（含优雅关闭）
   */
  async stop(): Promise<void> {
    log.info('GatewayServer 正在关闭...');

    // ① 清除心跳
    stopHeartbeat(this.heartbeatTimer);
    this.heartbeatTimer = null;

    // ② 关闭所有 WebSocket 连接
    for (const [, ws] of this.store.entries()) {
      ws.close(1_001, 'Server shutdown');
    }
    this.store.clear();

    // ③ 关闭 Fastify（包含 graceful shutdown）
    if (this.fastify) {
      await this.fastify.close();
      this.fastify = null;
    }

    log.info('GatewayServer 已关闭');
    this.emit('stopped');
  }

  /**
   * 向指定连接发送消息（兼容旧 API）
   */
  send(connectionId: string, message: GatewayMessage | ResponseMessage | EventMessage): void {
    this.messenger.send(connectionId, message as GatewayMessage);
  }

  /**
   * 向所有已连接客户端广播消息（兼容旧 API）
   *
   * @returns 发送统计 { sent, total }
   */
  broadcast(message: GatewayMessage): { sent: number; total: number } {
    return this.messenger.broadcast(message);
  }
}
