/**
 * ChannelProvider 渠道统一接口定义（完整版）
 *
 * 所有渠道适配器必须实现此接口。
 * 每个渠道的职责：将外部平台的原始消息转换为框架标准 Message，并将 Agent 回复回传。
 *
 * @module @myopenclaw/server/channels
 */

import type {
  InboundMessage,
  OutboundMessage,
  MessageTarget,
  SendMessageResult,
  ChannelConfig,
  ChannelContext,
  ChannelStatus,
  ChannelCapabilities,
} from './types.js';

/**
 * 渠道适配器完整接口
 *
 * 实现此接口即可将任意消息平台接入 MyOpenClaw 系统。
 * 接口包含完整的生命周期管理（initialize → start → stop）、
 * 消息收发（onMessage 回调 / sendMessage）、状态查询等能力。
 */
export interface ChannelProvider {
  /** 渠道唯一标识符 */
  readonly id: string;

  /** 渠道显示名称 */
  readonly displayName: string;

  /** 渠道能力声明 */
  readonly capabilities: ChannelCapabilities;

  /**
   * 初始化渠道
   * 加载配置，验证参数，准备运行环境。
   * 在 start() 之前调用。
   *
   * @param config - 渠道配置对象
   * @throws 配置校验失败时抛出错误
   */
  initialize(config: ChannelConfig): Promise<void>;

  /**
   * 启动渠道
   * 建立与目标平台的连接（WebSocket / Webhook），开始接收消息。
   * 启动后通过 context.onMessage 回调上报归一化后的消息。
   *
   * @param context - 渠道运行上下文，包含消息回调、错误回调、日志等
   * @throws 启动失败时抛出错误
   */
  start(context: ChannelContext): Promise<void>;

  /**
   * 停止渠道
   * 断开连接，释放定时器、HTTP 服务等所有资源。
   * 停止后不再接收或发送消息。
   */
  stop(): Promise<void>;

  /**
   * 重连渠道
   * 在连接异常断开后尝试重新建立连接。
   *
   * @returns true 表示重连成功，false 表示重连失败
   */
  reconnect?(): Promise<boolean>;

  /**
   * 发送消息到渠道
   * 将 Agent 生成的回复消息转换为平台格式后发送给用户。
   *
   * @param target - 消息发送目标（用户或群组）
   * @param message - 待发送的出站消息
   * @returns 发送结果，包含成功状态和平台消息 ID
   */
  sendMessage(target: MessageTarget, message: OutboundMessage): Promise<SendMessageResult>;

  /**
   * 获取渠道当前状态
   *
   * @returns 渠道状态快照，包含运行状态、统计信息等
   */
  getStatus(): ChannelStatus;

  /**
   * 健康检查
   * 验证渠道与目标平台的连接是否正常。
   *
   * @returns true 表示健康，false 表示异常
   */
  healthCheck?(): Promise<boolean>;

  /**
   * 设置消息接收回调（兼容旧版 API）
   * 用于设置从平台接收到消息时的处理函数。
   *
   * @param callback - 消息处理回调
   */
  setOnMessage?(callback: (message: InboundMessage) => void): void;
}

/**
 * 旧版 ChannelProvider 接口（向后兼容）
 *
 * 保留此接口以确保已实现基础接口的类不会报错。
 * 新实现的渠道适配器应使用完整的 ChannelProvider 接口。
 */
export interface LegacyChannelProvider {
  readonly id: string;

  /** 启动渠道，开始监听外部连接 */
  start(): Promise<void>;

  /** 停止渠道，释放所有资源 */
  stop(): Promise<void>;

  /** 向该渠道发送消息（Agent 响应回传） */
  send(message: { id: string; channelId: string; userId: string; text?: string; content?: string }): Promise<void>;

  /** 获取渠道当前状态 */
  getStatus(): string;
}

/**
 * 将 InboundMessage 转换为 Gateway Router 使用的 NormalizedMessage 格式
 *
 * @param msg - 入站消息
 * @returns 可被 Router.route() 使用的标准化消息
 */
export function toNormalizedMessage(msg: InboundMessage): {
  messageId: string;
  channelId: string;
  userId: string;
  userName?: string;
  content: string;
  messageType: 'text' | 'image' | 'file' | 'audio' | 'video';
  attachments?: Array<{ type: 'image' | 'file' | 'audio' | 'video'; url: string; filename?: string; size?: number; mimeType?: string }>;
  raw: unknown;
  timestamp: number;
} {
  const msgType = mapMessageType(msg.messageType);
  return {
    messageId: msg.messageId,
    channelId: msg.channelId,
    userId: msg.userId,
    userName: msg.displayName ?? msg.username,
    content: msg.text ?? '',
    messageType: msgType,
    attachments: msg.attachments?.map((att) => ({
      type: att.type,
      url: att.url,
      filename: att.filename,
      size: att.size,
      mimeType: att.mimeType,
    })),
    raw: msg.raw,
    timestamp: msg.timestamp,
  };
}

/** 将 Channels MessageType 映射为 Router 使用的消息类型 */
function mapMessageType(type: string): 'text' | 'image' | 'file' | 'audio' | 'video' {
  switch (type) {
    case 'image':
    case 'IMAGE':
      return 'image';
    case 'file':
    case 'FILE':
      return 'file';
    case 'audio':
    case 'AUDIO':
      return 'audio';
    case 'video':
    case 'VIDEO':
      return 'video';
    default:
      return 'text';
  }
}
