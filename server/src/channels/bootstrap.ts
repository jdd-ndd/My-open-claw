/**
 * Channels 渠道模块引导器
 *
 * 职责：
 *   1. 从主配置 (config/config.yaml + include channels/*.yaml) 读取并归一化各渠道配置
 *   2. 将 QQBot / 飞书 / 微信 三个 Provider 注册到 ChannelManager
 *   3. 启动所有 enabled 渠道
 *   4. 设置入站消息路由处理器：渠道入站消息 → Gateway Router → AgentBridge → 渠道出站
 *
 * 该模块是渠道层与 Gateway 之间的粘合代码，弥补此前"渠道适配器已实现但未挂载"的缺口。
 *
 * @module @myopenclaw/server/channels/bootstrap
 */

import { ChannelManager } from './manager.js';
import { QQBotChannel } from './qqbot/index.js';
import { FeishuChannel } from './feishu/index.js';
import { WeChatChannel } from './wechat/index.js';
import { toNormalizedMessage } from './base.js';
import { MessageType } from './types.js';
import type {
  ChannelConfig,
  InboundMessage,
  OutboundMessage,
  MessageTarget,
  ReconnectConfig,
} from './types.js';
import { loadConfig } from '../core/config/index.js';
import type { AgentBridge } from '../gateway/agent-bridge.js';
import type { MessageRouter } from '../gateway/routing/index.js';
import type { Messenger } from '../gateway/server/messaging.js';
import { createLogger } from '../core/utils/logger.js';

const log = createLogger('channels:bootstrap');

/** Bootstrap 依赖：路由器与 Agent 桥接器 */
export interface ChannelsBootstrapDeps {
  router: MessageRouter;
  agentBridge: AgentBridge;
  /** 跨端消息广播器（可选，用于将外部渠道用户消息推送到 Web 端监控会话） */
  messenger?: Messenger;
}

/**
 * Channels 引导器
 *
 * 生命周期由 GatewayServer 管理：
 *   GatewayServer.start() → bootstrap.start()
 *   GatewayServer.stop()  → bootstrap.stop()
 */
export class ChannelsBootstrap {
  /** 复用 ChannelManager 单例，确保全局唯一 */
  private readonly manager = ChannelManager.getInstance();
  private started = false;

  constructor(private readonly deps: ChannelsBootstrapDeps) {}

  /** 获取 ChannelManager 实例（供 HTTP 路由查询状态等场景使用） */
  getChannelManager(): ChannelManager {
    return this.manager;
  }

  /** Bootstrap 是否已启动 */
  isStarted(): boolean {
    return this.started;
  }

  /**
   * 注册渠道 Provider、加载配置、启动所有渠道
   */
  async start(): Promise<void> {
    if (this.started) {
      log.warn('Channels bootstrap 已启动，跳过重复调用');
      return;
    }

    // 1. 注册三个渠道 Provider（幂等，重复注册会被覆盖并告警）
    this.manager.register('qqbot', () => new QQBotChannel());
    this.manager.register('feishu', () => new FeishuChannel());
    this.manager.register('wechat', () => new WeChatChannel());

    // 2. 设置入站消息路由处理器
    this.manager.setRouteHandler(async (message) => {
      await this.routeInbound(message);
    });

    // 3. 加载并归一化渠道配置（包含获取 QQBot access_token）
    const configs = await this.loadChannelConfigs();

    if (configs.length === 0) {
      log.info('未发现任何启用的外部渠道（feishu/qqbot/wechat），跳过渠道启动');
      this.started = true;
      return;
    }

    log.info({ count: configs.length }, '正在启动外部渠道...');

    // 4. 初始化 + 启动
    await this.manager.initializeAll(configs);
    await this.manager.startAll();
    this.started = true;

    const runningCount = this.manager.getRunningChannels().length;
    log.info({ total: configs.length, running: runningCount }, 'Channels bootstrap 完成');
  }

  /**
   * 停止所有渠道
   */
  async stop(): Promise<void> {
    if (!this.started) return;
    await this.manager.stopAll();
    this.started = false;
    log.info('Channels bootstrap 已停止');
  }

  // ══════════════════════════════════════════════════════════════
  // 配置加载与归一化
  // ══════════════════════════════════════════════════════════════

  /**
   * 从主配置读取并归一化各渠道配置
   *
   * 配置来源链：
   *   config/config.yaml (include)
   *     → config/channels/qqbot.yaml   (顶层 qqbot 字段)
   *     → config/channels/feishu.yaml  (顶层 feishu 字段)
   *     → config/channels/wechat.yaml  (顶层 wechat 字段)
   *
   * YAML 中各渠道字段结构差异较大，这里统一映射到 Provider 期望的扁平 ChannelConfig。
   */
  private async loadChannelConfigs(): Promise<ChannelConfig[]> {
    const config = loadConfig();
    const configs: ChannelConfig[] = [];

    // ── QQBot ──
    const qqbot = config.qqbot as Record<string, unknown> | undefined;
    if (qqbot && qqbot.enabled === true) {
      const ws = (qqbot.websocket as Record<string, unknown> | undefined) ?? {};
      const appId = String(qqbot.appId ?? '');
      const appSecret = String(qqbot.appSecret ?? qqbot.clientSecret ?? '');

      // QQ Bot API v2: 需要先通过 AppID + AppSecret 获取 access_token
      // 然后使用 "QQBot {access_token}" 格式进行 WebSocket 认证
      let botToken = qqbot.botToken ? String(qqbot.botToken) : '';
      if (!botToken && appId && appSecret) {
        try {
          botToken = await this.getQQBotAccessToken(appId, appSecret);
          log.info('QQBot access_token 获取成功');
        } catch (err) {
          log.error({ err: (err as Error).message }, 'QQBot access_token 获取失败');
          throw new Error(`QQBot access_token 获取失败: ${(err as Error).message}`);
        }
      }

      configs.push({
        channelId: 'qqbot',
        enabled: true,
        appId,
        botToken,
        // qqbot.yaml 中 wsUrl/heartbeatInterval 在 websocket 嵌套下，这里拍平
        wsUrl: String(ws.url ?? qqbot.wsUrl ?? 'wss://api.sgroup.qq.com/websocket'),
        heartbeatInterval: Number(ws.heartbeatInterval ?? qqbot.heartbeatInterval ?? 30000),
        reconnect: this.normalizeReconnect(qqbot.reconnect),
      } as unknown as ChannelConfig);
    }

    // ── 飞书 ──
    const feishu = config.feishu as Record<string, unknown> | undefined;
    if (feishu && feishu.enabled === true) {
      configs.push({
        channelId: 'feishu',
        enabled: true,
        appId: String(feishu.appId ?? ''),
        appSecret: String(feishu.appSecret ?? ''),
        encryptKey: feishu.encryptKey ? String(feishu.encryptKey) : undefined,
        verificationToken: feishu.verificationToken ? String(feishu.verificationToken) : undefined,
        port: Number(feishu.port ?? 9876),
        path: String(feishu.path ?? '/webhook/feishu'),
        requireMentionInGroup: Boolean(feishu.requireMentionInGroup ?? true),
        tokenRefreshInterval: Number(feishu.tokenRefreshInterval ?? 7200000),
        // 事件接收模式：long_connection(长连接) / webhook(HTTP回调)
        eventMode: String(feishu.eventMode ?? 'long_connection') as 'webhook' | 'long_connection',
        heartbeatInterval: Number(feishu.heartbeatInterval ?? 30000),
        reconnect: this.normalizeReconnect(feishu.reconnect),
      } as unknown as ChannelConfig);
    }

    // ── 微信 ──
    const wechat = config.wechat as Record<string, unknown> | undefined;
    if (wechat && wechat.enabled === true) {
      const msg = (wechat.message as Record<string, unknown> | undefined) ?? {};
      const mode = String(wechat.mode ?? 'miniprogram') as 'webhook' | 'wecom' | 'miniprogram';
      configs.push({
        channelId: 'wechat',
        enabled: true,
        mode,
        appId: String(wechat.appId ?? ''),
        appSecret: String(wechat.appSecret ?? ''),
        token: wechat.token ? String(wechat.token) : undefined,
        encodingAESKey: wechat.encodingAESKey ? String(wechat.encodingAESKey) : undefined,
        callbackPort: Number(wechat.callbackPort ?? 9879),
        callbackPath: String(wechat.callbackPath ?? '/webhook/wechat'),
        corpId: wechat.corpId ? String(wechat.corpId) : undefined,
        agentId: wechat.agentId ? Number(wechat.agentId) : undefined,
        secret: wechat.secret ? String(wechat.secret) : undefined,
        maxLength: Number(msg.maxLength ?? 2048),
        autoReply: Boolean(msg.autoReply ?? true),
        reconnect: this.normalizeReconnect(wechat.reconnect),
      } as unknown as ChannelConfig);
    }

    return configs;
  }

  /**
   * 归一化重连配置
   */
  private normalizeReconnect(raw: unknown): ReconnectConfig | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const r = raw as Record<string, unknown>;
    return {
      enabled: Boolean(r.enabled ?? true),
      maxAttempts: Number(r.maxAttempts ?? 10),
      initialInterval: Number(r.initialInterval ?? 1000),
      maxInterval: Number(r.maxInterval ?? 30000),
      backoffFactor: Number(r.backoffFactor ?? 2),
    };
  }

  /**
   * 获取 QQ Bot access_token
   *
   * QQ Bot API v2 要求使用 access_token 进行 WebSocket 认证，
   * 需要通过 AppID + AppSecret 调用 API 获取。
   *
   * API: https://bots.qq.com/app/getAppAccessToken
   * 请求体: { appId: "xxx", clientSecret: "xxx" }
   * 返回: { access_token: "xxx", expires_in: 7200 }
   *
   * @param appId - QQ Bot AppID
   * @param appSecret - QQ Bot AppSecret
   * @returns access_token 原始字符串（不含前缀）
   */
  private async getQQBotAccessToken(appId: string, appSecret: string): Promise<string> {
    const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        appId,
        clientSecret: appSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as { access_token?: string; expires_in?: number };

    if (!data.access_token) {
      throw new Error('QQ Bot API 返回的数据中没有 access_token');
    }

    // 只返回原始 access_token，不添加前缀
    // 使用时在 qqbot/index.ts 中统一添加 "QQBot " 前缀
    return data.access_token;
  }

  // ══════════════════════════════════════════════════════════════
  // 入站消息路由处理
  // ══════════════════════════════════════════════════════════════

  /**
   * 处理来自渠道的入站消息
   *
   * 流程：
   *   1. 归一化 → NormalizedMessage
   *   2. 路由匹配 → 获取 agentId + session
   *   3. 调用 AgentBridge → 获取 LLM 回复
   *   4. 通过 ChannelManager 将回复发送回原渠道
   */
  private async routeInbound(message: InboundMessage): Promise<void> {
    try {
      // 1. 转换为 Router 期望的 NormalizedMessage 格式
      const normalized = toNormalizedMessage(message);

      // 2. 路由匹配
      const routeResult = await this.deps.router.route(normalized);
      if (!routeResult.matched) {
        log.warn(
          { channelId: message.channelId, userId: message.userId },
          '渠道消息未匹配到路由规则，已丢弃',
        );
        return;
      }

      // ── 跨端同步：将外部渠道用户消息推送到 Web 端监控会话 ──
      // 在 Agent 调用前推送，确保 Web 端能先看到用户消息，再看到助手回复
      // 助手回复由 AgentBridge.invoke 内部推送，此处只推送用户消息
      if (this.deps.messenger) {
        this.deps.messenger.broadcastToChannel('myopenclaw', {
          type: 'event',
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          event: 'channel.message',
          payload: {
            sourceChannel: message.channelId,
            sourceUserId: message.userId,
            sourceUsername: message.username,
            sourceDisplayName: message.displayName,
            sourceSessionId: routeResult.session!.sessionId,
            chatType: message.chatType,
            groupId: message.groupId,
            groupName: message.groupName,
            message: {
              role: 'user',
              content: message.text ?? '',
              messageId: message.messageId,
              timestamp: message.timestamp,
            },
          },
        });
      }

      // 3. 调用 Agent（matched=true 时 agentId 与 session 必有值）
      const result = await this.deps.agentBridge.invoke({
        agentId: routeResult.agentId!,
        message: message.text ?? '',
        channelId: message.channelId,
        userId: message.userId,
        sessionId: routeResult.session!.sessionId,
      });

      // 4. 构造出站消息并发送回原渠道
      // 关键：将入站消息的 platformMessageId 传递为 replyToMessageId，
      // 以便渠道适配器（如 QQBot）在请求体中加入 msg_id 实现被动回复，
      // 避免主动消息频控限制（QQ Bot 单聊每月 4 条、群聊每月 4 条）。
      const outbound: OutboundMessage = {
        messageType: MessageType.TEXT,
        text: result.response,
        markdown: true,
        replyToMessageId: message.platformMessageId,
      };

      const target: MessageTarget = message.chatType === 'group'
        ? { chatType: 'group', groupId: message.groupId }
        : { chatType: 'private', userId: message.userId };

      const sendResult = await this.manager.sendToChannel(message.channelId, target, outbound);
      if (!sendResult.success) {
        log.error(
          { channelId: message.channelId, error: sendResult.error },
          '渠道回复发送失败',
        );
      }
    } catch (err) {
      log.error(
        { err: (err as Error).message, channelId: message.channelId },
        '渠道入站消息处理失败',
      );
    }
  }
}
