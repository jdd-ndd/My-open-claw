/**
 * Gateway 缃戝叧鏈嶅姟 - GatewayServer
 */

import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyCompress from '@fastify/compress';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { createLogger } from '../../core/utils/logger.js';
import { getConfig } from '../../core/config/loader.js';
import { MemoryStorage } from '../core/storage.js';
import { SessionManager } from '../sessions/index.js';
import { MessageRouter } from '../routing/index.js';
import { SecuritySandbox } from '../security/index.js';
import { TokenService } from '../security/token-service.js';
import { AuditLogger } from '../audit/index.js';
import { TaskScheduler } from '../scheduler/index.js';
import { StateManager } from '../state/index.js';
import { AgentBridge } from '../agent-bridge.js';
import { AgentRuntimeAdapter } from './agent-runtime-adapter.js';
import { ConnectionStore } from './connection-store.js';
import { createMessenger } from './messaging.js';
import { registerHttpRoutes } from './http-routes.js';
import { handleConnection } from './websocket-handler.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import { buildSwaggerOptions, buildSwaggerUiOptions } from './swagger.js';
import {
  createAuthMiddleware,
  createRateLimitMiddleware,
  createLoggingMiddleware,
  registerErrorHandler,
} from './middleware/index.js';
import { ChannelsBootstrap } from '../../channels/bootstrap.js';
import type { GatewayServerConfig } from './types.js';
import type { GatewayMessage, ResponseMessage, EventMessage } from '../protocol.js';

const log = createLogger('gateway:server');

const DEFAULT_MAX_MESSAGE_SIZE = 500 * 1024;
const DEFAULT_WS_MAX_PAYLOAD = 1 * 1024 * 1024;

export type { GatewayServerConfig } from './types.js';

export class GatewayServer extends EventEmitter {
  readonly config: GatewayServerConfig;
  private fastify: FastifyInstance | null = null;
  readonly storage: MemoryStorage;
  readonly sessions: SessionManager;
  readonly router: MessageRouter;
  readonly sandbox: SecuritySandbox;
  readonly tokenService: TokenService;
  readonly audit: AuditLogger;
  readonly scheduler: TaskScheduler;
  readonly stateManager: StateManager;
  readonly agentBridge: AgentBridge;
  private runtimeAdapter: AgentRuntimeAdapter | null = null;
  private runtimeAdapterPromise: Promise<AgentRuntimeAdapter> | null = null;
  private readonly store: ConnectionStore;
  private readonly messenger: ReturnType<typeof createMessenger>;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** 渠道引导器：注册并启动 QQBot / 飞书 / 微信 等外部渠道 */
  private readonly channelsBootstrap: ChannelsBootstrap;

  constructor(config?: Partial<GatewayServerConfig>) {
    super();
    this.setMaxListeners(100);

    this.config = {
      host: config?.host ?? '127.0.0.1',
      port: config?.port ?? 18780,
      heartbeatInterval: config?.heartbeatInterval ?? 30_000,
      maxConnections: config?.maxConnections ?? 1_000,
      requestTimeout: config?.requestTimeout ?? 30_000,
      security: config?.security,
      audit: config?.audit,
      scheduler: config?.scheduler,
      version: config?.version ?? '1.0.0',
    };

    // 使用持久化存储，数据保存到 server/data/sessions.json
    // 这样服务器重启后会话数据不会丢失
    const dataDir = join(process.cwd(), 'data');
    const storageFile = join(dataDir, 'sessions.json');
    this.storage = new MemoryStorage(storageFile);
    this.sessions = new SessionManager(this.storage);
    this.sessions.initDatabase();

    this.router = new MessageRouter(this.sessions);
    this.router.loadRules([
      {
        id: 'default',
        priority: 100,
        channels: [
          { channelId: 'tui', userIds: ['*'] },
          { channelId: 'myopenclaw', userIds: ['*'] },
          { channelId: 'webchat', userIds: ['*'] },
          { channelId: 'feishu', userIds: ['*'] },
          { channelId: 'qqbot', userIds: ['*'] },
          { channelId: 'wechat', userIds: ['*'] },
          { channelId: 'wechat_mini', userIds: ['*'] },
          { channelId: 'wechat_wecom', userIds: ['*'] },
        ],
      },
    ]);

    this.store = new ConnectionStore();
    this.messenger = createMessenger(this.store);

    this.sandbox = new SecuritySandbox({
      apiToken: this.config.security?.apiToken ?? '',
      rateLimit: this.config.security?.rateLimit ?? 100,
      sandboxEnabled: this.config.security?.sandboxEnabled ?? false,
      allowedCommands: this.config.security?.allowedCommands ?? [],
      dangerPatterns: this.config.security?.dangerPatterns ?? [],
    });

    this.tokenService = new TokenService({
      secret: this.config.security?.secret,
      defaultExpiryDays: this.config.security?.tokenExpiryDays ?? 30,
    });

    this.audit = new AuditLogger(this.storage, this.config.audit?.logFilePath ?? './data/audit.jsonl');
    this.stateManager = new StateManager(this.config.version ?? '1.0.0');
    // 注入 messenger 到 AgentBridge，用于将外部渠道（QQBot/飞书）消息推送到 Web 端监控会话
    this.agentBridge = new AgentBridge(this.audit, this.stateManager, this.sessions, undefined, this.messenger);
    this.agentBridge.bind(this.ensureRuntimeAdapter());

    // 初始化渠道引导器（QQBot / 飞书 / 微信），具体启停由 start()/stop() 控制
    // 注入 messenger，用于将外部渠道用户消息推送到 Web 端监控会话
    this.channelsBootstrap = new ChannelsBootstrap({
      router: this.router,
      agentBridge: this.agentBridge,
      messenger: this.messenger,
    });

    this.scheduler = new TaskScheduler(this.storage, {
      invoke: async (params) => {
        const result = await this.agentBridge.invoke(params);
        return result.response;
      },
    });
    this.scheduler.initDatabase();

    log.info(
      {
        host: this.config.host,
        port: this.config.port,
        version: this.config.version,
      },
      'GatewayServer 瀹炰緥宸插垱寤?',
    );
  }

  async start(): Promise<void> {
    log.info({ host: this.config.host, port: this.config.port }, 'GatewayServer 姝ｅ湪鍚姩...');

    const runtimeAdapter = await this.ensureRuntimeAdapter();

    this.fastify = Fastify({
      logger: false,
      requestTimeout: this.config.requestTimeout,
      maxParamLength: 200,
    });

    await this.fastify.register(fastifyCors, {
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    });

    await this.fastify.register(fastifyCompress, {
      global: true,
      threshold: 1024,
    });

    await this.fastify.register(fastifySwagger, buildSwaggerOptions());
    await this.fastify.register(fastifySwaggerUi, buildSwaggerUiOptions());
    await this.fastify.register(fastifyWebsocket, {
      options: { maxPayload: DEFAULT_WS_MAX_PAYLOAD },
    });

    await this.registerMiddleware();

    registerHttpRoutes(this.fastify, this.store, this.router, this.sessions, this.config, {
      tokenService: this.tokenService,
      audit: this.audit,
      scheduler: this.scheduler,
      stateManager: this.stateManager,
      runtimeAdapter,
      messenger: this.messenger,
    });

    const wsDeps = {
      store: this.store,
      router: this.router,
      sessions: this.sessions,
      maxMessageSize: DEFAULT_MAX_MESSAGE_SIZE,
      emitter: this as EventEmitter,
      messenger: this.messenger,
      maxConnections: this.config.maxConnections,
      sandbox: this.sandbox,
      tokenService: this.tokenService,
      audit: this.audit,
      stateManager: this.stateManager,
      scheduler: this.scheduler,
      agentBridge: this.agentBridge,
    };

    this.fastify.register(async (scope) => {
      scope.get('/ws', { websocket: true }, (socket) => {
        handleConnection(socket, wsDeps);
      });
    });

    // 尝试监听配置端口，若被占用则自动递增寻找可用端口（最多尝试 50 次）
    // 解决 tsx watch 重启或旧进程残留时 EADDRINUSE 导致启动失败的问题
    const maxAttempts = 50;
    let actualPort = this.config.port;
    let bound = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const probe = createServer();
      const portOk = await new Promise<boolean>((resolve) => {
        probe.once('error', (err: NodeJS.ErrnoException) => {
          resolve(err.code !== 'EADDRINUSE');
        });
        probe.once('listening', () => {
          probe.close(() => resolve(true));
        });
        probe.listen(actualPort, this.config.host);
      });

      if (portOk) {
        try {
          await this.fastify.listen({
            host: this.config.host,
            port: actualPort,
          });
          bound = true;
          break;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'EADDRINUSE') throw err;
        }
      }
      log.warn({ port: actualPort }, `端口被占用，尝试下一个端口 ${actualPort + 1}`);
      actualPort++;
    }

    if (!bound) {
      throw new Error(`无法找到可用端口，已尝试 ${this.config.port} ~ ${actualPort - 1}`);
    }
    // 实际绑定的端口可能与配置不同（被占用时自动递增），同步到 config 供后续日志/渠道使用
    (this.config as GatewayServerConfig & { port: number }).port = actualPort;

    this.heartbeatTimer = startHeartbeat(this.store, this.config.heartbeatInterval);

    if (this.config.scheduler?.loadSavedTasks !== false) {
      await this.scheduler.start();
    }

    this.stateManager.updateResources();

    // 启动外部渠道（QQBot / 飞书 / 微信），仅启动配置中 enabled=true 的渠道
    try {
      await this.channelsBootstrap.start();
    } catch (err) {
      log.error({ err: (err as Error).message }, '外部渠道启动失败，继续启动 Gateway');
    }

    this.audit.logEntry({
      category: 'system',
      event: 'gateway.start',
      details: {
        host: this.config.host,
        port: this.config.port,
        version: this.config.version,
      },
      success: true,
    });

    log.info({ host: this.config.host, port: this.config.port }, 'GatewayServer 鍚姩瀹屾垚');
    this.emit('started', this.config);
  }

  async stop(): Promise<void> {
    log.info('GatewayServer 姝ｅ湪鍏抽棴...');

    // 先停止外部渠道，避免停止后仍有入站消息流入已关闭的 Router
    try {
      await this.channelsBootstrap.stop();
    } catch (err) {
      log.error({ err: (err as Error).message }, '外部渠道停止异常');
    }

    await this.scheduler.stop();

    if (this.heartbeatTimer) {
      stopHeartbeat(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const [connectionId, socket] of this.store.entries()) {
      try {
        socket.close(1001, 'Server shutting down');
      } catch {
        log.warn({ connectionId }, '鍏抽棴杩炴帴鏃跺嚭鐜板紓甯?');
      }
    }
    this.store.clear();

    if (this.fastify) {
      await this.fastify.close();
      this.fastify = null;
    }

    await this.audit.close();
    this.emit('stopped');
    log.info('GatewayServer 宸插叧闂?');
  }

  getConnectionCount(): number {
    return this.store.size;
  }

  listConnectionIds(): string[] {
    return Array.from(this.store.entries(), ([connectionId]) => connectionId);
  }

  getConnection(connectionId: string) {
    return this.store.get(connectionId);
  }

  send(connectionId: string, message: GatewayMessage): boolean {
    const socket = this.store.get(connectionId);
    if (!socket) {
      this.emit('error', connectionId, new Error('Connection not found or closed'));
      return false;
    }

    this.messenger.send(connectionId, message);
    return true;
  }

  broadcast(message: GatewayMessage, filter?: (connectionId: string) => boolean): number {
    if (!filter) {
      return this.messenger.broadcast(message).sent;
    }

    let sent = 0;
    for (const [connectionId] of this.store.entries()) {
      if (!filter(connectionId)) {
        continue;
      }

      if (this.send(connectionId, message)) {
        sent += 1;
      }
    }

    return sent;
  }

  closeConnection(connectionId: string, code = 1000, reason = 'Normal Closure'): boolean {
    const socket = this.store.get(connectionId);
    if (!socket) {
      return false;
    }

    socket.close(code, reason);
    this.store.delete(connectionId);
    this.emit('disconnection', connectionId, code, reason);
    return true;
  }

  emitEvent(connectionId: string, eventName: string, payload: Record<string, unknown>): boolean {
    const message: EventMessage = {
      type: 'event',
      id: `event_${Date.now()}`,
      timestamp: new Date().toISOString(),
      event: eventName,
      payload,
    };
    return this.send(connectionId, message);
  }

  sendResponse(connectionId: string, requestId: string, success: boolean, data?: unknown, error?: { code: string; message: string }): boolean {
    const message: ResponseMessage = {
      type: 'response',
      id: `resp_${Date.now()}`,
      timestamp: new Date().toISOString(),
      requestId,
      status: success ? 'success' : 'error',
      payload: success ? { data } : {},
      ...(success ? {} : { errorCode: error?.code, errorMessage: error?.message }),
    };
    return this.send(connectionId, message);
  }

  setAgentInvoker(invoker: { invoke: (params: {
    agentId: string;
    message: string;
    channelId?: string;
    userId?: string;
    taskId?: string;
  }) => Promise<string> }): void {
    this.scheduler.setAgentInvoker(invoker);
  }

  static fromConfig(): GatewayServer {
    const cfg: Partial<GatewayServerConfig> = {
      host: getConfig<string>('network.ws.host', '127.0.0.1'),
      port: getConfig<number>('network.ws.port', 18780),
      heartbeatInterval: getConfig<number>('gateway.heartbeatInterval', 30_000),
      maxConnections: getConfig<number>('gateway.maxConnections', 1_000),
      requestTimeout: getConfig<number>('gateway.requestTimeout', 30_000),
      version: getConfig<string>('gateway.version', '1.0.0'),
      security: {
        apiToken: getConfig<string>('security.apiToken', ''),
        rateLimit: getConfig<number>('security.rateLimit', 100),
        sandboxEnabled: getConfig<boolean>('security.sandboxEnabled', false),
        allowedCommands: getConfig<string[]>('security.allowedCommands', []),
        dangerPatterns: getConfig('security.dangerPatterns', []),
        secret: getConfig<string>('security.secret', 'myopenclaw-default-secret-change-me'),
        tokenExpiryDays: getConfig<number>('security.tokenExpiryDays', 30),
      },
      audit: {
        logFilePath: getConfig<string>('audit.logFilePath', './data/audit.jsonl'),
      },
      scheduler: {
        loadSavedTasks: getConfig<boolean>('scheduler.loadSavedTasks', true),
      },
    };

    return new GatewayServer(cfg);
  }

  private async registerMiddleware(): Promise<void> {
    if (!this.fastify) {
      return;
    }

    registerErrorHandler(this.fastify, this.audit);

    const authMw = createAuthMiddleware(this.sandbox, this.tokenService);
    this.fastify.addHook('onRequest', authMw);

    const rateLimitMw = createRateLimitMiddleware(this.sandbox);
    this.fastify.addHook('onRequest', rateLimitMw);

    const loggingMw = createLoggingMiddleware(this.audit);
    this.fastify.addHook('onResponse', loggingMw);

    log.info('涓棿浠堕摼宸叉敞鍐? Auth -> RateLimit -> Logging -> ErrorHandler');
  }

  private async ensureRuntimeAdapter(): Promise<AgentRuntimeAdapter> {
    if (this.runtimeAdapter) {
      return this.runtimeAdapter;
    }

    if (!this.runtimeAdapterPromise) {
      this.runtimeAdapterPromise = AgentRuntimeAdapter.create({}).then((adapter) => {
        this.runtimeAdapter = adapter;
        return adapter;
      });
    }

    return this.runtimeAdapterPromise;
  }
}
