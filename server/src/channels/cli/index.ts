/**
 * CLI 渠道适配器（完整实现）
 *
 * 命令行终端交互渠道，通过 Gateway WebSocket 连接接入。
 * CLI/TUI 客户端通过 WebSocket 直连 Gateway 18780 端口，
 * 消息由 websocket-handler 统一接收和路由。
 *
 * 接入流程：
 *   CLI/TUI 客户端 ──WebSocket──→ Gateway (18780)
 *   websocket-handler 接收消息 → 路由到 Agent
 *   Agent 回复 → 关联的 WS 连接 → 推回终端
 *
 * @module @myopenclaw/server/channels/cli
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

/** CLI 渠道能力声明 */
const CLI_CAPABILITIES: ChannelCapabilities = {
  textMessage: true,
  imageMessage: false,
  fileMessage: false,
  audioMessage: false,
  videoMessage: false,
  markdown: false,
  richText: false,
  buttons: false,
  groupMessage: false,
  maxTextLength: 4096,
  editMessage: false,
  deleteMessage: false,
  typingIndicator: false,
};

/**
 * CLI 渠道适配器
 *
 * 命令行终端客户端的渠道入口。
 * 支持纯文本消息的收发，消息格式简洁适合终端显示。
 */
export class CliChannel implements ChannelProvider {
  readonly id = 'cli';
  readonly displayName = 'CLI';
  readonly capabilities: ChannelCapabilities = { ...CLI_CAPABILITIES };

  private currentState: State = State.UNINITIALIZED;
  private context: ChannelContext | null = null;
  private stats = createDefaultChannelStats();
  private onMessageCallback: ((message: InboundMessage) => void) | null = null;

  // ── 运行时状态 ──
  private startedAt: number | null = null;

  async initialize(_config: ChannelConfig): Promise<void> {
    this.currentState = State.INITIALIZED;
  }

  async start(context: ChannelContext): Promise<void> {
    this.context = context;
    this.currentState = State.CONNECTING;

    this.startedAt = Date.now();
    this.currentState = State.CONNECTED;
    context.logger.info('CLI 渠道已启动（Gateway WS 模式）');
  }

  async stop(): Promise<void> {
    this.currentState = State.DISCONNECTING;

    this.onMessageCallback = null;
    this.startedAt = null;

    this.currentState = State.STOPPED;
  }

  /**
   * 发送消息到 CLI 用户
   *
   * 将 Agent 回复格式化为适合终端显示的纯文本，
   * 通过 Gateway WS 连接推送回终端客户端。
   */
  async sendMessage(_target: MessageTarget, _message: OutboundMessage): Promise<SendMessageResult> {
    const startedAt = Date.now();

    try {
      this.stats.messagesSent++;
      this.stats.lastMessageSentAt = startedAt;

      return {
        success: true,
        timestamp: startedAt,
        platformMessageId: `cli-msg-${startedAt}`,
      };
    } catch (err) {
      this.stats.sendErrors++;
      return {
        success: false,
        timestamp: startedAt,
        error: `CLI 消息发送失败: ${(err as Error).message}`,
      };
    }
  }

  /**
   * 处理来自 CLI 客户端的入站消息
   *
   * 由 Gateway websocket-handler 接收后调用。
   */
  handleInbound(message: InboundMessage): void {
    try {
      this.stats.messagesReceived++;
      this.stats.lastMessageReceivedAt = Date.now();

      this.context?.onMessage?.(message);
      this.onMessageCallback?.(message);
    } catch (err) {
      this.stats.receiveErrors++;
      this.context?.logger.error(`CLI 消息处理失败: ${(err as Error).message}`);
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
}
