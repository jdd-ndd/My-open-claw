/**
 * 飞书渠道适配器（完整实现）
 *
 * 对接飞书开放平台，实现：
 *   1. tenant_access_token 自动获取与定时刷新
 *   2. HTTP 回调服务器接收飞书事件推送
 *   3. 消息事件处理（文本/图片/文件/富文本/卡片交互）
 *   4. 主动消息发送（通过飞书 IM API）
 *
 * 接入流程：
 *   飞书用户 ──消息──→ 飞书服务器 ──Webhook──→ 本渠道 HTTP 服务器 (callbackPort)
 *   本渠道 → normalizeFeishuMessage() → context.onMessage() → Gateway → Agent
 *   Agent 回复 → sendMessage() → 飞书 IM API → 用户
 *
 * 参考文档：https://open.feishu.cn/document/server-docs/im-v1/message-content-description
 *
 * @module @myopenclaw/server/channels/feishu
 */

import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { ChannelProvider } from '../base.js';
import { ChannelLifecycleState as State } from '../types.js';
import type {
  ChannelConfig,
  ChannelContext,
  ChannelStatus,
  ChannelCapabilities,
  OutboundMessage,
  MessageTarget,
  SendMessageResult,
  InboundMessage,
} from '../types.js';
import { createDefaultChannelStats } from '../types.js';
import { normalizeFeishuMessage } from './normalizer.js';
import type { FeishuEvent } from './normalizer.js';
import { FeishuLongConnectionClient, LongConnectionState } from './long-connection.js';

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** 飞书 Open API 基地址 */
const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

/** tenant_access_token 获取地址 */
const TOKEN_URL = `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`;

/** 发送消息 API */
const SEND_MESSAGE_URL = `${FEISHU_API_BASE}/im/v1/messages?receive_id_type=open_id`;

/** Token 提前刷新时间（3 分钟），避免 token 在请求中过期 */
const TOKEN_REFRESH_BEFORE_MS = 3 * 60 * 1000;

/** Token 刷新间隔（默认 2 小时） */
const TOKEN_REFRESH_INTERVAL_MS = 1.5 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 飞书渠道完整配置 */
interface FeishuChannelConfig extends ChannelConfig {
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  port: number;
  path: string;
  requireMentionInGroup: boolean;
  tokenRefreshInterval: number;
  /** 事件接收模式：webhook(HTTP回调) / long_connection(长连接) */
  eventMode?: 'webhook' | 'long_connection';
  /** 长连接心跳间隔（毫秒），默认 30 秒 */
  heartbeatInterval?: number;
}

/** 飞书默认能力声明 */
const FEISHU_CAPABILITIES: ChannelCapabilities = {
  textMessage: true,
  imageMessage: true,
  fileMessage: true,
  audioMessage: true,
  videoMessage: false,
  markdown: true,
  richText: true,
  buttons: true,
  groupMessage: true,
  maxTextLength: 30000,
  editMessage: true,
  deleteMessage: true,
  typingIndicator: true,
};

// ═══════════════════════════════════════════════════════════════
// FeishuChannel 核心类
// ═══════════════════════════════════════════════════════════════

export class FeishuChannel implements ChannelProvider {
  readonly id = 'feishu';
  readonly displayName = 'Feishu';
  readonly capabilities: ChannelCapabilities = { ...FEISHU_CAPABILITIES };

  private currentState: State = State.UNINITIALIZED;
  private config: FeishuChannelConfig | null = null;
  private context: ChannelContext | null = null;
  private stats = createDefaultChannelStats();

  // ── Token 管理 ──
  private tenantAccessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private tokenRefreshTimer: ReturnType<typeof setInterval> | null = null;

  // ── HTTP 服务器 ──
  private httpServer: ReturnType<typeof createServer> | null = null;

  // ── 长连接客户端 ──
  private longConnection: FeishuLongConnectionClient | null = null;

  // ── 运行时状态 ──
  private startedAt: number | null = null;
  private onMessageCallback: ((message: InboundMessage) => void) | null = null;
  private _eventLogged = false;  // 调试日志开关

  // ═════════════════════════════════════════════════════════════
  // 生命周期
  // ═════════════════════════════════════════════════════════════

  async initialize(config: ChannelConfig): Promise<void> {
    this.config = config as FeishuChannelConfig;
    if (!this.config.appId) throw new Error('飞书渠道配置缺少 appId');
    if (!this.config.appSecret) throw new Error('飞书渠道配置缺少 appSecret');
    if (!this.config.port) throw new Error('飞书渠道配置缺少 port');
    if (!this.config.path) throw new Error('飞书渠道配置缺少 path');
    this.currentState = State.INITIALIZED;
  }

  async start(context: ChannelContext): Promise<void> {
    this.context = context;
    this.currentState = State.CONNECTING;

    try {
      // 1. 获取 tenant_access_token
      await this.refreshToken();
      context.logger.info('飞书 tenant_access_token 获取成功');

      // 2. 根据事件模式选择接入方式
      const eventMode = this.config!.eventMode ?? 'webhook';
      if (eventMode === 'long_connection') {
        // 长连接模式：通过 WebSocket 接收事件
        await this.startLongConnection();
        context.logger.info('飞书长连接已启动（无需公网 IP）');
      } else {
        // Webhook 模式：通过 HTTP 回调接收事件
        await this.startHttpServer();
        context.logger.info(`飞书回调服务器已启动: http://0.0.0.0:${this.config!.port}${this.config!.path}`);
      }

      // 3. 启动 token 定时刷新
      this.startTokenRefresh();

      this.startedAt = Date.now();
      this.currentState = State.CONNECTED;
      context.logger.info(`飞书渠道已完整启动 (${eventMode === 'long_connection' ? '长连接模式' : 'Webhook模式'})`);
    } catch (err) {
      this.currentState = State.ERROR;
      context.logger.error(`飞书渠道启动失败: ${(err as Error).message}`);
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.currentState = State.DISCONNECTING;

    // 停止 token 刷新
    this.stopTokenRefresh();

    // 关闭长连接
    if (this.longConnection) {
      this.longConnection.stop();
      this.longConnection = null;
    }

    // 关闭 HTTP 服务器
    await this.stopHttpServer();

    this.tenantAccessToken = null;
    this.onMessageCallback = null;
    this.startedAt = null;

    this.currentState = State.STOPPED;
  }

  // ═════════════════════════════════════════════════════════════
  // Token 管理
  // ═════════════════════════════════════════════════════════════

  /**
   * 获取 tenant_access_token
   *
   * 调用飞书 API：POST /auth/v3/tenant_access_token/internal
   * 文档：https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal
   */
  private async refreshToken(): Promise<string> {
    const { appId, appSecret } = this.config!;

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`获取 tenant_access_token 失败 (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      code: number;
      msg: string;
      tenant_access_token: string;
      expire: number;
    };

    if (data.code !== 0) {
      throw new Error(`飞书 API 错误 (code=${data.code}): ${data.msg}`);
    }

    this.tenantAccessToken = data.tenant_access_token;
    // 提前 3 分钟过期，确保 token 使用时始终有效
    this.tokenExpiresAt = Date.now() + (data.expire * 1000) - TOKEN_REFRESH_BEFORE_MS;

    this.context?.logger.debug('tenant_access_token 已刷新');
    return data.tenant_access_token;
  }

  /**
   * 确保 token 有效
   */
  private async ensureToken(): Promise<string> {
    if (!this.tenantAccessToken || Date.now() >= this.tokenExpiresAt) {
      await this.refreshToken();
    }
    return this.tenantAccessToken!;
  }

  private startTokenRefresh(): void {
    this.tokenRefreshTimer = setInterval(async () => {
      try {
        await this.refreshToken();
      } catch (err) {
        this.context?.logger.error(`token 刷新失败: ${(err as Error).message}`);
      }
    }, this.config!.tokenRefreshInterval || TOKEN_REFRESH_INTERVAL_MS);
  }

  private stopTokenRefresh(): void {
    if (this.tokenRefreshTimer) {
      clearInterval(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
  }

  // ═════════════════════════════════════════════════════════════
  // HTTP 回调服务器
  // ═════════════════════════════════════════════════════════════

  /**
   * 启动 HTTP 服务器接收飞书事件回调（Webhook 模式）
   */
  private async startHttpServer(): Promise<void> {
    const { port, path } = this.config!;

    return new Promise<void>((resolve, reject) => {
      this.httpServer = createServer(async (req, res) => {
        // 仅处理配置的路径
        if (!req.url?.startsWith(path ?? '/')) {
          res.writeHead(404);
          res.end();
          return;
        }

        // 预检请求（OPTIONS）
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          });
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end();
          return;
        }

        try {
          // 读取请求体
          const body = await readRequestBody(req);

          // 处理 URL 验证（飞书首次配置 Webhook 时的 Challenge）
          if (body) {
            try {
              const parsed = JSON.parse(body);
              if (parsed.type === 'url_verification') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ challenge: parsed.challenge }));
                return;
              }
            } catch { /* 非 JSON 跳过 */ }
          }

          // 处理事件回调
          await this.processEvent(body);

          // 返回成功（飞书要求 200）
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 0 }));
        } catch (err) {
          this.context?.logger.error(`飞书事件处理失败: ${(err as Error).message}`);
          res.writeHead(200); // 依然返回 200 避免飞书重试
          res.end();
        }
      });

      this.httpServer.on('error', (err) => {
        reject(err);
      });

      this.httpServer.listen(port, '0.0.0.0', () => {
        resolve();
      });
    });
  }

  /**
   * 关闭 HTTP 服务器
   */
  private async stopHttpServer(): Promise<void> {
    if (!this.httpServer) return;
    return new Promise<void>((resolve) => {
      this.httpServer!.close(() => resolve());
      this.httpServer = null;
    });
  }

  // ═════════════════════════════════════════════════════════════
  // 长连接客户端
  // ═════════════════════════════════════════════════════════════

  /**
   * 启动飞书长连接客户端
   *
   * 使用飞书官方 SDK (@larksuiteoapi/node-sdk) 的 WSClient 建立 WebSocket 长连接，
   * SDK 内部自动处理鉴权、心跳、断线重连等逻辑。
   * 无需公网 IP 和端口映射，适用于个人开发者和内网环境。
   */
  private async startLongConnection(): Promise<void> {
    this.longConnection = new FeishuLongConnectionClient(
      {
        appId: this.config!.appId,
        appSecret: this.config!.appSecret,
        heartbeatInterval: this.config!.heartbeatInterval,
      },
      {
        info: (msg) => this.context?.logger.info(`[飞书长连接] ${msg}`),
        error: (msg) => this.context?.logger.error(`[飞书长连接] ${msg}`),
        debug: (msg) => this.context?.logger.debug(`[飞书长连接] ${msg}`),
      },
    );

    // 设置事件回调：接收事件后交给 processEvent 处理
    // SDK 传递的事件数据格式与飞书事件回调格式一致
    this.longConnection.onEvent((event) => {
      // SDK 的事件数据已经是解密后的明文 JSON
      // 直接交给 processEvent 处理
      const rawBody = JSON.stringify(event);
      this.processEvent(rawBody).catch((err) => {
        this.context?.logger.warn(`飞书长连接事件处理失败: ${err.message}`);
      });
    });

    // 启动连接（SDK 内部会自动建立 WebSocket 连接并保持运行）
    await this.longConnection.start();

    // 监听长连接状态变化
    const stateCheck = setInterval(() => {
      if (!this.longConnection) {
        clearInterval(stateCheck);
        return;
      }
      const state = this.longConnection.getState();
      if (state === LongConnectionState.RECONNECTING) {
        this.context?.logger.warn('飞书长连接正在重连...');
      }
    }, 5000);
  }

  // ═════════════════════════════════════════════════════════════
  // 事件处理
  // ═════════════════════════════════════════════════════════════

  /**
   * 处理飞书事件回调
   *
   * 支持事件类型：
   *   - im.message.receive_v1：接收消息（文本/图片/文件/富文本）
   *
   * @param rawBody 原始请求体
   */
  private async processEvent(rawBody: string): Promise<void> {
    try {
      const parsed: FeishuEvent = JSON.parse(rawBody);

      // 检查事件头（飞书 v2 事件格式）
      const header = (parsed as any).header;
      if (header) {
        const eventType = header.event_type;
        this.context?.logger.debug(`收到飞书事件: ${eventType}`);
      }

      // 调试日志：打印事件结构（仅在首次或出错时）
      if (!this._eventLogged) {
        this.context?.logger.info(`飞书事件结构: keys=${Object.keys(parsed).join(', ')} hasEvent=${!!(parsed as any).event} hasMessage=${!!(parsed as any).message}`);
        this._eventLogged = true;
      }

      // 使用归一化器转换消息（兼容 Webhook 和 SDK 长连接两种格式）
      const normalized = normalizeFeishuMessage(parsed);
      if (!normalized) {
        return; // 不支持的事件类型，静默忽略
      }

      // 统计
      this.stats.messagesReceived++;
      this.stats.lastMessageReceivedAt = Date.now();

      // 推送到 Gateway
      this.context?.onMessage?.(normalized);
      this.onMessageCallback?.(normalized);
    } catch (err) {
      this.stats.receiveErrors++;
      this.context?.logger.warn(`飞书事件解析失败: ${(err as Error).message}`);
    }
  }

  /**
   * 处理飞书事件（供外部直接调用）
   */
  handleEvent(rawBody: string): InboundMessage | null {
    try {
      const event: FeishuEvent = JSON.parse(rawBody);
      const normalized = normalizeFeishuMessage(event);
      if (normalized) {
        this.stats.messagesReceived++;
        this.stats.lastMessageReceivedAt = Date.now();
        this.context?.onMessage?.(normalized);
        this.onMessageCallback?.(normalized);
      }
      return normalized;
    } catch {
      this.stats.receiveErrors++;
      return null;
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 消息发送
  // ═════════════════════════════════════════════════════════════

  /**
   * 发送消息到飞书用户
   *
   * 调用飞书 IM API：POST /im/v1/messages
   * 文档：https://open.feishu.cn/document/server-docs/im-v1/message/create
   *
   * @param target 发送目标（用户 ID 或群 ID）
   * @param message 出站消息
   */
  async sendMessage(target: MessageTarget, message: OutboundMessage): Promise<SendMessageResult> {
    const startedAt = Date.now();

    try {
      const token = await this.ensureToken();

      // 构建飞书消息体
      const body = this.buildFeishuMessageBody(target, message);

      const response = await fetch(SEND_MESSAGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`飞书消息发送失败 (${response.status}): ${errBody.slice(0, 200)}`);
      }

      const data = (await response.json()) as {
        code: number;
        msg: string;
        data?: { message_id: string };
      };

      if (data.code !== 0) {
        throw new Error(`飞书 API 错误 (code=${data.code}): ${data.msg}`);
      }

      this.stats.messagesSent++;
      this.stats.lastMessageSentAt = startedAt;

      return {
        success: true,
        timestamp: startedAt,
        platformMessageId: data.data?.message_id,
      };
    } catch (err) {
      this.stats.sendErrors++;
      return {
        success: false,
        timestamp: startedAt,
        error: `飞书消息发送失败: ${(err as Error).message}`,
      };
    }
  }

  /**
   * 构建飞书消息体
   *
   * 支持类型：text、post（富文本）、interactive（卡片）
   */
  private buildFeishuMessageBody(
    target: MessageTarget,
    message: OutboundMessage,
  ): Record<string, unknown> {
    const receiveId = target.userId ?? target.groupId;
    if (!receiveId) throw new Error('飞书消息发送需要目标用户ID');

    // 文本消息（默认）和富文本消息
    if (String(message.messageType) === 'text') {
      const text = message.text ?? '';
      const maxLen = this.capabilities.maxTextLength;

      return {
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({
          text: text.length > maxLen ? text.slice(0, maxLen - 3) + '...' : text,
        }),
      };
    }

    // 富文本消息（post）
    if (message.markdown) {
      // 飞书富文本 post 格式
      const contentItems: Array<Array<Record<string, unknown>>> = [[
        {
          tag: 'text',
          text: message.text ?? '',
        },
      ]];

      // 如果有附件，转换为图片/链接
      if (message.attachments) {
        for (const att of message.attachments) {
          if (att.type === 'image' && att.url) {
            contentItems.push([{
              tag: 'img',
              image_key: att.url,
            }]);
          }
        }
      }

      return {
        receive_id: receiveId,
        msg_type: 'post',
        content: JSON.stringify({
          zh_cn: {
            title: 'MyOpenClaw 回复',
            content: contentItems,
          },
        }),
      };
    }

    // 图片消息
    if (message.messageType === 'image' && message.attachments?.[0]?.url) {
      return {
        receive_id: receiveId,
        msg_type: 'image',
        content: JSON.stringify({
          image_key: message.attachments[0].url,
        }),
      };
    }

    // 文件消息
    if (message.messageType === 'file' && message.attachments?.[0]?.url) {
      return {
        receive_id: receiveId,
        msg_type: 'file',
        content: JSON.stringify({
          file_key: message.attachments[0].url,
        }),
      };
    }

    // 默认：文本消息
    return {
      receive_id: receiveId,
      msg_type: 'text',
      content: JSON.stringify({ text: message.text ?? '' }),
    };
  }

  // ═════════════════════════════════════════════════════════════
  // 状态查询
  // ═════════════════════════════════════════════════════════════

  getStatus(): ChannelStatus {
    return {
      state: this.currentState,
      channelId: this.id,
      displayName: this.displayName,
      isRunning: this.currentState === State.CONNECTED,
      startedAt: this.startedAt ?? undefined,
      reconnectAttempts: 0,
      stats: { ...this.stats },
    };
  }

  setOnMessage(callback: (message: InboundMessage) => void): void {
    this.onMessageCallback = callback;
  }
}

// ═══════════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════════

/**
 * 读取 HTTP 请求体
 */
function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
