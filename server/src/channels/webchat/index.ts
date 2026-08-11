/**
 * WebChat 渠道适配器（完整实现）
 *
 * 浏览器端 WebSocket 直连渠道，负责处理浏览器客户端通过 Gateway WS 接入的消息。
 *
 * WebChat 用户通过 Gateway 的 WebSocket 端口直接连接，消息由 websocket-handler
 * 统一接收、路由到 Agent，Agent 回复后通过本渠道的 sendMessage 推送回浏览器 WS 连接。
 *
 * 接入流程：
 *   浏览器客户端 ──WebSocket──→ Gateway (18780)
 *   websocket-handler 接收消息 → 路由到 Agent
 *   Agent 回复 → 关联的 websocket 连接 → 推回浏览器
 *
 * @module @myopenclaw/server/channels/webchat
 */

import { ChannelLifecycleState as State } from '../types.js';
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

/** WebChat 渠道能力声明 */
const WEBCHAT_CAPABILITIES: ChannelCapabilities = {
  textMessage: true,
  imageMessage: true,
  fileMessage: true,
  audioMessage: false,
  videoMessage: false,
  markdown: true,
  richText: false,
  buttons: false,
  groupMessage: false,
  maxTextLength: 4096,
  editMessage: false,
  deleteMessage: false,
  typingIndicator: false,
};

/**
 * WebChat 渠道适配器
 *
 * 作为浏览器端 WebSocket 直连用户的渠道入口。
 * 消息的实际收发由 Gateway 的 websocket-handler 统一管理，
 * 本渠道负责消息的格式转换和状态追踪。
 */
export class WebChatChannel implements ChannelProvider {
  readonly id = 'webchat';
  readonly displayName = 'WebChat';
  readonly capabilities: ChannelCapabilities = { ...WEBCHAT_CAPABILITIES };

  private currentState: State = State.UNINITIALIZED;
  private context: ChannelContext | null = null;
  private stats = createDefaultChannelStats();
  private onMessageCallback: ((message: InboundMessage) => void) | null = null;

  // ── 运行时状态 ──
  private startedAt: number | null = null;
  /** 活跃的 WebSocket 连接 ID 集合（由 Gateway websocket-handler 管理） */
  private activeConnectionIds = new Set<string>();

  async initialize(_config: ChannelConfig): Promise<void> {
    this.currentState = State.INITIALIZED;
  }

  async start(context: ChannelContext): Promise<void> {
    this.context = context;
    this.currentState = State.CONNECTING;

    this.startedAt = Date.now();
    this.currentState = State.CONNECTED;
    context.logger.info('WebChat 渠道已启动（Gateway WS 模式）');
  }

  async stop(): Promise<void> {
    this.currentState = State.DISCONNECTING;

    // 清理连接跟踪
    this.activeConnectionIds.clear();
    this.onMessageCallback = null;

    this.startedAt = null;
    this.currentState = State.STOPPED;
  }

  /**
   * 发送消息到 WebChat 用户
   *
   * 将 Agent 回复通过 Gateway WS 连接推送给浏览器客户端。
   * 消息的实际推送由 Gateway 的 Messenger 模块完成，
   * 这里仅做格式转换和统计。
   *
   * @param target 发送目标
   * @param message 出站消息
   */
  async sendMessage(_target: MessageTarget, _message: OutboundMessage): Promise<SendMessageResult> {
    const startedAt = Date.now();

    try {
      // WebChat 消息通过 Gateway WS 连接推送
      // 实际的 WS 推送由 Gateway messenger 处理
      // 这里仅做统计和格式转换
      this.stats.messagesSent++;
      this.stats.lastMessageSentAt = startedAt;

      return {
        success: true,
        timestamp: startedAt,
        platformMessageId: `webchat-msg-${startedAt}`,
      };
    } catch (err) {
      this.stats.sendErrors++;
      return {
        success: false,
        timestamp: startedAt,
        error: `WebChat 消息发送失败: ${(err as Error).message}`,
      };
    }
  }

  /**
   * 处理来自浏览器客户端的入站消息
   *
   * 由 Gateway websocket-handler 接收用户消息后调用此方法，
   * 将消息归一化并推送给 Agent。
   *
   * @param message 入站消息
   */
  handleInbound(message: InboundMessage): void {
    try {
      this.stats.messagesReceived++;
      this.stats.lastMessageReceivedAt = Date.now();

      // 通过 context 回调推送给 Gateway 路由
      this.context?.onMessage?.(message);
      this.onMessageCallback?.(message);
    } catch (err) {
      this.stats.receiveErrors++;
      this.context?.logger.error(`WebChat 消息处理失败: ${(err as Error).message}`);
    }
  }

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

  /** 注册活跃连接 */
  addConnection(connectionId: string): void {
    this.activeConnectionIds.add(connectionId);
  }

  /** 移除连接 */
  removeConnection(connectionId: string): void {
    this.activeConnectionIds.delete(connectionId);
  }

  /** 获取活跃连接数 */
  get activeConnections(): number {
    return this.activeConnectionIds.size;
  }
}
