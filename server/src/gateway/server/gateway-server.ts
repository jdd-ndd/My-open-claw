/**
 * Gateway 网关服务 —— GatewayServer
 *
 * 基于 Fastify（HTTP）+ @fastify/websocket（WebSocket）双协议的网关服务器。
 * 负责管理 WebSocket 客户端连接、接收/分发消息、心跳保活、
 * 健康检查，并内置 MessageRouter 进行消息路由。
 *
 * 本文件为 orchestration 层，通过组合以下单一职责模块完成网关功能：
 * - {@link ConnectionStore} 连接与元数据存储
 * - {@link Messenger} 消息发送与广播
 * - {@link registerHttpRoutes} HTTP 路由注册
 * - {@link handleConnection} WebSocket 连接与消息处理
 * - {@link startHeartbeat} / {@link stopHeartbeat} 心跳保活
 *
 * 所有子系统共享同一个 {@link MemoryStorage} 实例，
 * 确保路由、审计、调度的数据一致性。
 *
 * @module @myopenclaw/server/gateway
 */

import { EventEmitter } from 'node:events';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyCompress from '@fastify/compress';
import { createLogger } from '../../core/utils/logger.js';
import { MemoryStorage } from '../core/storage.js';
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

  /** 共享内存存储实例（路由器、审计、调度器共用） */
  readonly storage: MemoryStorage;

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

    // 创建共享存储并注入到 MessageRouter
    this.storage = new MemoryStorage();
    this.router = new MessageRouter(this.storage);
    this.router.initDatabase();

    this.store = new ConnectionStore();
    this.messenger = createMessenger(this.store);
  }

  /**
   * 启动网关服务器
   */
  async start(): Promise<void> {
    log.info({ host: this.config.host, port: this.config.port }, 'GatewayServer 正在启动...');

    this.fastify = Fastify({
      logger: false,
      requestTimeout: this.config.requestTimeout,
      maxParamLength: 200,
    });

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
      options: { maxPayload: DEFAULT_WS_MAX_PAYLOAD },
    });

    registerHttpRoutes(this.fastify, this.store, this.router, this.config);

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

    await this.fastify.listen({
      host: this.config.host,
      port: this.config.port,
    });

    this.heartbeatTimer = startHeartbeat(this.store, this.config.heartbeatInterval);

    log.info({ host: this.config.host, port: this.config.port }, 'GatewayServer 启动完成');
    this.emit('started', this.config);
  }

  /**
   * 停止网关服务器
   */
  async stop(): Promise<void> {
    log.info('GatewayServer 正在关闭...');

    stopHeartbeat(this.heartbeatTimer);
    this.heartbeatTimer = null;

    for (const [, ws] of this.store.entries()) {
      ws.close(1_001, 'Server shutdown');
    }
    this.store.clear();

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
   */
  broadcast(message: GatewayMessage): { sent: number; total: number } {
    return this.messenger.broadcast(message);
  }
}
