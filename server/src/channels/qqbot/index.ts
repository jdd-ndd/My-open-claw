/**
 * QQBot 渠道适配器 — 完整实现
 *
 * 基于 QQ Bot API v2 的完整渠道适配实现。
 * 通过 WebSocket 连接 QQ 开放平台，实现消息的双向流转。
 * 支持文本、图片、富文本消息类型，以及频道群聊和私聊。
 *
 * 接入标准：
 * - 平台 SDK：QQ Bot API v2（WebSocket 模式）
 * - 认证方式：Bot AppID + Bot Token
 * - WebSocket 地址：wss://api.sgroup.qq.com/websocket
 * - 消息格式：JSON（WebSocket Payload）
 *
 * @module @myopenclaw/server/channels/qqbot
 */

import { ChannelLifecycleState as State, MessageType } from '../types.js';
import type { ChannelProvider } from '../base.js';
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
import { transition, canTransition } from '../lifecycle.js';
import { ReconnectManager } from '../reconnect.js';
import {
  normalizeQQBotMessage,
  isQQBotHello,
  isQQBotReady,
  isQQBotHeartbeatAck,
} from './normalizer.js';
import type { QQBotPayload } from './normalizer.js';


/**
 * QQBot 渠道完整配置
 */
interface QQBotChannelConfig extends ChannelConfig {
  /** Bot AppID */
  appId: string;
  /** Bot Token */
  botToken: string;
  /** WebSocket 连接 URL */
  wsUrl: string;
  /** 心跳间隔（毫秒），默认 30000 */
  heartbeatInterval: number;
}

/** QQBot 默认能力声明 */
const QQ_BOT_CAPABILITIES: ChannelCapabilities = {
  textMessage: true,
  imageMessage: true,
  fileMessage: true,
  audioMessage: true,
  videoMessage: false,
  markdown: true,
  richText: false,
  buttons: true,
  groupMessage: true,
  maxTextLength: 2000,
  editMessage: false,
  deleteMessage: false,
  typingIndicator: false,
};

/**
 * QQBot 渠道适配器
 *
 * 基于 QQ Bot API v2 的完整实现，通过 WebSocket 接收消息，
 * 通过 HTTP API 发送消息。支持频道消息和私聊消息。
 *
 * @example
 * ```typescript
 * const channel = new QQBotChannel();
 * await channel.initialize({
 *   channelId: 'qqbot',
 *   enabled: true,
 *   appId: '102001234',
 *   botToken: 'your_token',
 *   wsUrl: 'wss://api.sgroup.qq.com/websocket',
 *   heartbeatInterval: 30000,
 * });
 * await channel.start(context);
 * ```
 */
export class QQBotChannel implements ChannelProvider {
  readonly id = 'qqbot';
  readonly displayName = 'QQBot';
  readonly capabilities: ChannelCapabilities = { ...QQ_BOT_CAPABILITIES };

  // ---- 状态 ----
  private currentState: State = State.UNINITIALIZED;
  private config: QQBotChannelConfig | null = null;
  private context: ChannelContext | null = null;

  // ---- 连接 ----
  private ws: import('ws').WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectManager: ReconnectManager | null = null;

  // ---- 统计 ----
  private stats = createDefaultChannelStats();
  private startedAt: number | null = null;
  private lastConnectedAt: number | null = null;
  private lastDisconnectedAt: number | null = null;
  private reconnectAttempts = 0;
  private errorMessage: string | null = null;

  // ---- 消息回调（兼容旧版） ----
  private onMessageCallback: ((message: InboundMessage) => void) | null = null;

  // ══════════════════════════════════════════════════════════════
  // 生命周期方法
  // ══════════════════════════════════════════════════════════════

  /**
   * 初始化渠道
   *
   * @param config - 渠道配置
   */
  async initialize(config: ChannelConfig): Promise<void> {
    const qqConfig = config as QQBotChannelConfig;
    if (!qqConfig.appId) throw new Error('QQBot 渠道配置缺少 appId');
    if (!qqConfig.botToken) throw new Error('QQBot 渠道配置缺少 botToken');

    this.config = {
      ...qqConfig,
      wsUrl: qqConfig.wsUrl ?? 'wss://api.sgroup.qq.com/websocket',
      heartbeatInterval: qqConfig.heartbeatInterval ?? 30000,
    };

    this.setState(State.INITIALIZED);
  }

  /**
   * 启动渠道（建立 WebSocket 连接）
   *
   * @param context - 渠道运行上下文
   */
  async start(context: ChannelContext): Promise<void> {
    if (!this.config) throw new Error('QQBot 渠道尚未初始化');

    this.context = context;
    this.setState(State.CONNECTING);

    // 初始化重连管理器
    this.reconnectManager = new ReconnectManager(
      { id: this.id, reconnect: () => this.doReconnect() },
      this.config.reconnect ?? { enabled: true, maxAttempts: 10, initialInterval: 1000, maxInterval: 30000, backoffFactor: 2 },
    );
    this.reconnectManager
      .setOnSuccess(() => this.setReconnectAttempts(0))
      .setOnGiveUp(() => {
        this.errorMessage = `已达到最大重连次数`;
        this.setState(State.ERROR);
      });

    try {
      await this.connectWebSocket();
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.setState(State.ERROR);
      throw err;
    }
  }

  /**
   * 停止渠道
   */
  async stop(): Promise<void> {
    this.setState(State.DISCONNECTING);

    // 停止重连管理器
    this.reconnectManager?.stop();
    this.reconnectManager = null;

    // 停止心跳
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // 关闭 WebSocket 连接
    if (this.ws) {
      this.ws.close(1000, 'Channel stopped');
      this.ws = null;
    }

    this.startedAt = null;
    this.setState(State.STOPPED);
  }

  /**
   * 重连
   */
  async reconnect(): Promise<boolean> {
    return this.doReconnect();
  }

  // ══════════════════════════════════════════════════════════════
  // 消息方法
  // ══════════════════════════════════════════════════════════════

  /**
   * 发送消息到 QQ
   *
   * QQ Bot 消息发送分两种模式：
   * - 被动回复：携带 msg_id（用户消息 ID），有效期 60 分钟（单聊）/ 5 分钟（群聊），最多 5 次
   * - 主动消息：不携带 msg_id，每月每用户/群 4 条，且用户可在 QQ 客户端关闭
   *
   * 本实现优先使用被动回复：当 OutboundMessage.replyToMessageId 存在时，
   * 将其作为 msg_id 传入请求体，以避免主动消息频控限制。
   *
   * @param target - 消息目标（userId 为 user_openid，groupId 为 group_openid）
   * @param message - 出站消息
   * @returns 发送结果
   */
  async sendMessage(target: MessageTarget, message: OutboundMessage): Promise<SendMessageResult> {
    try {
      if (!this.config) throw new Error('QQBot 渠道未初始化');

      // 群聊使用 group_openid，单聊使用 user_openid
      const url = target.chatType === 'group'
        ? `https://api.sgroup.qq.com/v2/groups/${target.groupId}/messages`
        : `https://api.sgroup.qq.com/v2/users/${target.userId}/messages`;

      // 构建消息体，包含 msg_id 实现被动回复
      const body = this.buildQQMessageBody(message);

      // 调试日志：把实际请求体输出，方便排查 40011000 请求数据异常
      console.log(`[QQBot Send] URL=${url} 请求体=${JSON.stringify(body)}`);

      // 使用 fetch 发送 HTTP 请求到 QQ Bot API
      // botToken 存储的是原始 access_token，需要添加 "QQBot " 前缀
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `QQBot ${this.config.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`QQBot API 错误: HTTP ${response.status} ${errorText}`);
      }

      const result = (await response.json()) as { id?: string };
      this.stats.messagesSent++;
      this.stats.lastMessageSentAt = Date.now();

      return {
        success: true,
        platformMessageId: result.id,
        timestamp: Date.now(),
      };
    } catch (err) {
      this.stats.sendErrors++;
      const error = err instanceof Error ? err : new Error(String(err));
      this.context?.onError(error, this.id);

      return {
        success: false,
        timestamp: Date.now(),
        error: error.message,
      };
    }
  }

  /**
   * 获取渠道状态
   */
  getStatus(): ChannelStatus {
    return {
      state: this.currentState,
      channelId: this.id,
      displayName: this.displayName,
      isRunning: this.currentState === State.CONNECTED,
      startedAt: this.startedAt ?? undefined,
      lastConnectedAt: this.lastConnectedAt ?? undefined,
      lastDisconnectedAt: this.lastDisconnectedAt ?? undefined,
      reconnectAttempts: this.reconnectAttempts,
      errorMessage: this.errorMessage ?? undefined,
      stats: { ...this.stats },
    };
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    return this.currentState === State.CONNECTED && this.ws?.readyState === 1;
  }

  /**
   * 设置消息回调（兼容旧版 API）
   */
  setOnMessage(callback: (message: InboundMessage) => void): void {
    this.onMessageCallback = callback;
  }

  // ══════════════════════════════════════════════════════════════
  // 内部方法
  // ══════════════════════════════════════════════════════════════

  /**
   * 建立 WebSocket 连接
   */
  private async connectWebSocket(): Promise<void> {
    if (!this.config) throw new Error('配置未加载');

    const wsUrl = this.config.wsUrl;
    this.context?.logger.info(`正在连接 QQBot WebSocket: ${wsUrl}`);

    // 动态导入 ws 模块
    const { WebSocket } = await import('ws');

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      const timeout = setTimeout(() => {
        reject(new Error('WebSocket 连接超时'));
      }, 15000);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.onConnected();
        resolve();
      });

      ws.on('message', (rawData: Buffer) => {
        const text = rawData.toString();
        this.context?.logger.info(`QQBot 收到原始消息: ${text.substring(0, 300)}`);
        try {
          const payload = JSON.parse(text);
          this.handlePayload(payload);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          this.context?.logger.error(`QQBot 消息处理异常: ${errorMessage}`);
          this.stats.receiveErrors++;
        }
      });

      ws.on('error', (err: Error) => {
        clearTimeout(timeout);
        this.context?.logger.error('QQBot WebSocket 错误:', err.message);
        this.onDisconnected(err.message);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        this.context?.logger.info(`QQBot WebSocket 关闭: code=${code}`);
        this.onDisconnected(reason?.toString() ?? `code=${code}`);
      });
    });
  }

  /**
   * 连接成功
   */
  private onConnected(): void {
    this.lastConnectedAt = Date.now();
    this.errorMessage = null;
    this.setState(State.CONNECTED);
    this.context?.logger.info('QQBot WebSocket 连接成功');
  }

  /**
   * 断开连接
   */
  private onDisconnected(reason: string): void {
    this.lastDisconnectedAt = Date.now();

    // 停止心跳
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // 如果当前是已连接状态（异常断开），触发重连
    if (this.currentState === State.CONNECTED) {
      this.context?.logger.warn(`QQBot 连接断开: ${reason}`);
      this.reconnectAttempts++;
      this.setState(State.RECONNECTING);
      this.reconnectManager?.start();
    } else {
      this.setState(State.DISCONNECTED);
    }
  }

  /**
   * 执行实际重连
   */
  private async doReconnect(): Promise<boolean> {
    try {
      this.context?.logger.info('QQBot 正在重连...');
      await this.connectWebSocket();
      this.context?.logger.info('QQBot 重连成功');
      return true;
    } catch (err) {
      this.context?.logger.error('QQBot 重连失败:', err);
      return false;
    }
  }

  /**
   * 处理 WebSocket Payload
   *
   * QQ Bot WebSocket 协议流程：
   * 1. 客户端连接 → 服务端发送 Hello(op=10)
   * 2. 客户端发送 IDENTIFY(op=2) 携带 token 进行认证
   * 3. 服务端发送 READY(op=0, t=READY) 确认认证成功
   * 4. 客户端开始心跳(op=1)
   * 5. 服务端推送消息事件(op=0)
   */
  private handlePayload(payload: { op: number; d?: unknown; t?: string; s?: number }): void {
    // 详细调试日志
    this.context?.logger.info(`QQBot 处理 Payload: op=${payload.op}, t=${payload.t || 'N/A'}, d=${JSON.stringify(payload.d)?.substring(0, 200) || 'N/A'}`);

    // 构造 QQBotPayload，d 字段在事件分类阶段使用宽松类型
    // 待确认是消息事件后，再由 normalizeQQBotMessage 内部强制转换
    const qqPayload = payload as unknown as QQBotPayload;

    if (isQQBotHello(qqPayload)) {
      // Hello 事件：发送 IDENTIFY 认证包
      // QQ Bot 协议要求收到 Hello 后必须在限定时间内发送 IDENTIFY
      // 否则服务端会因会话超时（code=4009）断开连接
      this.context?.logger.info('QQBot 收到 Hello 事件，发送 IDENTIFY 认证包');
      this.sendIdentify();
      return;
    }

    if (isQQBotReady(qqPayload)) {
      // READY 事件：认证成功，此时才能启动心跳
      this.context?.logger.info('QQBot 收到 READY 事件，认证成功');
      this.startHeartbeat();
      this.context?.logger.info('QQBot READY 事件，心跳已启动');
      return;
    }

    if (isQQBotHeartbeatAck(qqPayload)) {
      // 心跳确认，忽略
      this.context?.logger.info('QQBot 收到心跳确认');
      return;
    }

    // 尝试归一化消息（只处理消息事件类型）
    const normalized = normalizeQQBotMessage(qqPayload as any);
    if (!normalized) {
      this.context?.logger.info(`QQBot Payload 无需处理 (op=${payload.op}, t=${payload.t || 'N/A'})`);
      return;
    }

    // 统计
    this.stats.messagesReceived++;
    this.stats.lastMessageReceivedAt = Date.now();

    if (normalized.chatType === 'group') {
      this.context?.logger.debug(
        `QQBot 收到群消息: groupId=${normalized.groupId}, userId=${normalized.userId}`,
      );
    } else {
      this.context?.logger.debug(
        `QQBot 收到私聊消息: userId=${normalized.userId}`,
      );
    }

    // 通过上下文回调或直接回调推送消息
    if (this.context?.onMessage) {
      this.context.onMessage(normalized);
    } else if (this.onMessageCallback) {
      this.onMessageCallback(normalized);
    }
  }

  /**
   * 发送 IDENTIFY 认证包
   *
   * QQ Bot WebSocket 协议要求在收到 Hello(op=10) 后，
   * 客户端必须发送 IDENTIFY(op=2) 携带 token 进行身份认证。
   * 如果不发送或超时未发送，服务端会在约 2 分钟后以 code=4009 断开连接。
   *
   * IDENTIFY 载荷结构：
   * - op: 2（操作码）
   * - d.token: 机器人 token（格式: "QQBot {access_token}"）
   * - d.intents: 订阅的事件意图（位运算，必须大于 0）
   * - d.shard: 分片信息 [shard_id, shard_count]
   *
   * QQ Bot API v2 intents 位定义（官方文档）：
   *   GUILDS (1 << 0) = 1              - 频道事件（基础权限）
   *   GUILD_MEMBERS (1 << 1) = 2       - 成员事件（基础权限）
   *   GUILD_MESSAGES (1 << 9) = 512    - 频道消息（私域机器人）
   *   DIRECT_MESSAGE (1 << 12) = 4096  - 频道私信
   *   GROUP_AND_C2C_EVENT (1 << 25) = 33554432 - C2C单聊 + 群聊@消息（需申请）
   *   PUBLIC_GUILD_MESSAGES (1 << 30) = 1073741824 - 频道@消息事件（基础权限）
   *
   * 注意：
   * 1. 基础权限事件(GUILDS, GUILD_MEMBERS, PUBLIC_GUILD_MESSAGES)默认可用，
   *    其他事件需要在 QQ 开放平台后台申请权限后才能订阅。
   * 2. intents 不能为 0，否则会报 invalid intents 错误（code=4013）。
   * 3. 订阅未授权的 intent 会报 disallowed intents 错误（code=4014）。
   *
   * 当前默认订阅：
   *   - GROUP_AND_C2C_EVENT (1<<25)：接收 C2C_MESSAGE_CREATE 和 GROUP_AT_MESSAGE_CREATE
   *   - PUBLIC_GUILD_MESSAGES (1<<30)：接收频道 @机器人消息
   * 计算结果：33554432 | 1073741824 = 1107296256
   */
  private sendIdentify(): void {
    if (!this.config || !this.ws || this.ws.readyState !== 1) return;

    // 计算 intents 位掩码
    // GROUP_AND_C2C_EVENT (1<<25)：C2C 单聊 + 群@消息（需在开放平台申请权限）
    // PUBLIC_GUILD_MESSAGES (1<<30)：频道 @机器人消息（基础权限默认可用）
    //
    // 如果未申请 GROUP_AND_C2C_EVENT 权限，连接会被以 code=4014 关闭，
    // 此时可以临时去掉 (1<<25)，只保留 (1<<30) 用于频道测试。
    const intents = (1 << 25) | (1 << 30);

    // botToken 存储的是原始 access_token，需要添加 "QQBot " 前缀
    const identifyPayload = {
      op: 2,
      d: {
        token: `QQBot ${this.config.botToken}`,
        intents,
        shard: [0, 1],
      },
    };

    this.ws.send(JSON.stringify(identifyPayload));
    this.context?.logger.info(`QQBot IDENTIFY 认证包已发送（intents=${intents}）`);
  }

  /**
   * 启动心跳保持连接
   */
  private startHeartbeat(): void {
    if (!this.config) return;

    const interval = this.config.heartbeatInterval;

    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ op: 1, d: Date.now() }));
      }
    }, interval);

    this.context?.logger.debug(`QQBot 心跳已启动 (间隔: ${interval}ms)`);
  }

  /**
   * 设置状态并通知 Gateway
   */
  private setState(newState: State): void {
    const oldState = this.currentState;
    if (oldState === newState) return;

    // 验证状态转换合法性
    if (canTransition(oldState, newState)) {
      this.currentState = transition(oldState, newState);
    } else {
      this.currentState = newState;
      this.context?.logger.warn(
        `QQBot 非标准状态转换: ${oldState} → ${newState}`,
      );
    }

    // 通知 Gateway
    this.context?.onStateChange?.(this.id, newState, oldState);
  }

  /**
   * 设置重连次数
   */
  private setReconnectAttempts(count: number): void {
    this.reconnectAttempts = count;
  }

  /**
   * 构建 QQ 消息体
   *
   * 关键字段（官方文档）：
   * - msg_type: 消息类型（0 文本 / 2 markdown / 3 ark / 4 embed / 7 富媒体）
   * - content: 文本内容（当 msg_type=0 或 markdown 时必填）
   * - msg_id: 用户消息 ID（用于被动回复，避免主动消息频控；传 null/undefined 会被 API 拒绝）
   * - msg_seq: 消息序号（uint32，用于过滤重复消息响应；同一条 msg_id 内多次回复用不同值区分）
   *
   * 重要细节：
   * 1. QQ Bot v2 API 对未定义字段非常敏感：不能传 undefined/null 值的字段，必须完全省略
   * 2. markdown 文本直接用 content 字段，不需要单独的 markdown 对象；msg_type=0 即可
   * 3. msg_seq 建议 1~255 区间循环递增，官方文档不支持 Date.now() 这样的大整数
   *
   * 被动回复规则（官方文档 2026/01/10 更新）：
   * - 单聊：60 分钟内最多回复 4 次
   * - 群聊：5 分钟内最多回复 5 次
   * - 不传 msg_id 视为主动消息，每月每用户/群限 4 条
   */
  private buildQQMessageBody(message: OutboundMessage): Record<string, unknown> {
    // msg_id：被动回复必需，从入站消息 platformMessageId 传入（由 bootstrap.ts 传递为 replyToMessageId）
    const msgId = message.replyToMessageId;
    // msg_seq：每次发送 +1（1~255 循环），用于去重；不传会被视为同一条消息的重复响应
    this._msgSeqCounter = ((this._msgSeqCounter ?? 0) % 255) + 1;
    const msgSeq = this._msgSeqCounter;

    switch (message.messageType) {
      case MessageType.IMAGE: {
        const body: Record<string, unknown> = {
          content: message.text ?? '',
          msg_type: 1, // 图文混排
          msg_seq: msgSeq,
        };
        if (msgId) body.msg_id = msgId;
        if (message.attachments?.length) {
          body.media = { file_info: message.attachments[0].url };
        }
        return body;
      }

      case MessageType.FILE: {
        const body: Record<string, unknown> = {
          content: message.text ?? '',
          msg_type: 7, // 文件消息
          msg_seq: msgSeq,
        };
        if (msgId) body.msg_id = msgId;
        if (message.attachments?.length) {
          body.media = { file_info: message.attachments[0].url };
        }
        return body;
      }

      case MessageType.AUDIO: {
        const body: Record<string, unknown> = {
          msg_type: 3, // 语音消息
          msg_seq: msgSeq,
        };
        if (msgId) body.msg_id = msgId;
        if (message.attachments?.length) {
          body.media = { file_info: message.attachments[0].url };
        }
        return body;
      }

      default: { // TEXT
        const body: Record<string, unknown> = {
          content: message.text ?? '',
          msg_type: 0, // 纯文本 / markdown 文本都走 msg_type=0
          msg_seq: msgSeq,
        };
        if (msgId) body.msg_id = msgId;
        if (message.buttons?.length) {
          body.keyboard = {
            content: {
              rows: message.buttons.map((btn) => ({
                buttons: [{
                  id: btn.callbackData ?? '1',
                  render_data: {
                    label: btn.text,
                    visited_label: btn.text,
                    style: btn.style === 'danger' ? 1 : btn.style === 'primary' ? 2 : 0,
                  },
                  action: {
                    type: btn.url ? 0 : 2,
                    permission: { type: 2 },
                    data: btn.callbackData ?? btn.text,
                    unsupport_tips: '当前版本不支持',
                  },
                }],
              })),
            },
          };
        }
        return body;
      }
    }
  }
  /** msg_seq 计数器（1~255 循环） */
  private _msgSeqCounter = 0;
}
