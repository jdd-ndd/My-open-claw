/**
 * Channels 渠道模块 — 完整类型定义
 *
 * 包含消息结构、生命周期状态、渠道配置、能力声明等所有核心类型。
 * 严格遵循文档 `04-Channels渠道模块.md` 中定义的接口规范。
 *
 * @module @myopenclaw/server/channels
 */

// ═══════════════════════════════════════════════════════════════
// 消息类型枚举
// ═══════════════════════════════════════════════════════════════

/** 消息类型枚举 */
export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  AUDIO = 'audio',
  VIDEO = 'video',
  STICKER = 'sticker',
  LOCATION = 'location',
  CONTACT = 'contact',
}

// ═══════════════════════════════════════════════════════════════
// 消息结构
// ═══════════════════════════════════════════════════════════════

/** 消息附件 */
export interface MessageAttachment {
  /** 附件类型 */
  type: 'image' | 'file' | 'audio' | 'video';
  /** 附件 URL（网络地址或本地路径） */
  url: string;
  /** 文件名 */
  filename?: string;
  /** 文件大小（字节） */
  size?: number;
  /** MIME 类型 */
  mimeType?: string;
  /** 图片宽度（图片附件） */
  width?: number;
  /** 图片高度（图片附件） */
  height?: number;
  /** 音频/视频时长（秒） */
  duration?: number;
  /** 缩略图 URL */
  thumbnailUrl?: string;
}

/** 消息按钮（交互式消息） */
export interface MessageButton {
  /** 按钮文本 */
  text: string;
  /** 按钮回调数据 */
  callbackData?: string;
  /** 点击后跳转的 URL */
  url?: string;
  /** 按钮样式 */
  style?: 'default' | 'primary' | 'danger';
}

/** 消息发送目标 */
export interface MessageTarget {
  /** 目标用户 ID（私聊） */
  userId?: string;
  /** 目标群组 ID（群聊） */
  groupId?: string;
  /** 聊天类型 */
  chatType: 'private' | 'group';
}

/** 消息发送结果 */
export interface SendMessageResult {
  /** 是否发送成功 */
  success: boolean;
  /** 平台返回的消息 ID */
  platformMessageId?: string;
  /** 发送时间戳 */
  timestamp: number;
  /** 错误信息（失败时存在） */
  error?: string;
}

/**
 * 入站消息（用户 → Agent）
 *
 * 从各平台接收到的消息经归一化后的统一结构。
 * 所有渠道适配器都必须将平台原始消息转换为此结构。
 */
export interface InboundMessage {
  /** 消息唯一 ID（由渠道生成或系统生成，通常带前缀防止跨渠道冲突） */
  messageId: string;
  /** 平台原始消息 ID（用于被动回复等场景，例如 QQ Bot 的 msg_id） */
  platformMessageId?: string;
  /** 来源渠道 ID */
  channelId: string;
  /** 发送者用户 ID（渠道内的用户标识） */
  userId: string;
  /** 发送者用户名 */
  username: string;
  /** 发送者显示名称 */
  displayName?: string;
  /** 会话类型：私聊 / 群组 */
  chatType: 'private' | 'group';
  /** 群组 ID（chatType 为 group 时存在） */
  groupId?: string;
  /** 群组名称 */
  groupName?: string;
  /** 消息内容类型 */
  messageType: MessageType;
  /** 文本内容（messageType 为 text 时存在） */
  text?: string;
  /** 附件列表（messageType 非 text 时存在） */
  attachments?: MessageAttachment[];
  /** 回复的消息 ID（如果是回复消息） */
  replyToMessageId?: string;
  /** 原始消息对象（保留平台原始数据） */
  raw: unknown;
  /** 消息时间戳（Unix 毫秒） */
  timestamp: number;
}

/**
 * 出站消息（Agent → 用户）
 *
 * Agent 生成回复后，转换为统一出站消息结构，
 * 再由渠道适配器转换为目标平台格式发送。
 */
export interface OutboundMessage {
  /** 消息内容类型 */
  messageType: MessageType;
  /** 文本内容 */
  text?: string;
  /** 附件列表 */
  attachments?: MessageAttachment[];
  /** 是否以 Markdown 格式发送 */
  markdown?: boolean;
  /** 交互按钮列表 */
  buttons?: MessageButton[];
  /** 回复的目标消息 ID（如果是回复） */
  replyToMessageId?: string;
  /** 是否禁用链接预览 */
  disableLinkPreview?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 渠道能力描述
// ═══════════════════════════════════════════════════════════════

/**
 * 渠道能力描述
 * 声明渠道支持的功能特性
 */
export interface ChannelCapabilities {
  /** 是否支持发送文本消息 */
  textMessage: boolean;
  /** 是否支持发送图片 */
  imageMessage: boolean;
  /** 是否支持发送文件 */
  fileMessage: boolean;
  /** 是否支持发送音频 */
  audioMessage: boolean;
  /** 是否支持发送视频 */
  videoMessage: boolean;
  /** 是否支持 Markdown 格式 */
  markdown: boolean;
  /** 是否支持富文本（HTML 等） */
  richText: boolean;
  /** 是否支持消息按钮（交互式消息） */
  buttons: boolean;
  /** 是否支持群组消息 */
  groupMessage: boolean;
  /** 最大文本消息长度 */
  maxTextLength: number;
  /** 是否支持消息编辑 */
  editMessage: boolean;
  /** 是否支持消息删除 */
  deleteMessage: boolean;
  /** 是否支持 typing 状态指示 */
  typingIndicator: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 生命周期状态
// ═══════════════════════════════════════════════════════════════

/**
 * 渠道运行状态
 * 描述渠道在生命周期各阶段的状态
 */
export enum ChannelLifecycleState {
  /** 未初始化：渠道刚创建，尚未加载配置 */
  UNINITIALIZED = 'uninitialized',
  /** 已初始化：配置已加载，资源已准备，但未启动 */
  INITIALIZED = 'initialized',
  /** 连接中：正在建立与目标平台的连接 */
  CONNECTING = 'connecting',
  /** 已连接：连接已建立，正在接收消息 */
  CONNECTED = 'connected',
  /** 断开中：正在断开连接 */
  DISCONNECTING = 'disconnecting',
  /** 已断开：连接已断开 */
  DISCONNECTED = 'disconnected',
  /** 重连中：连接异常断开后正在尝试重连 */
  RECONNECTING = 'reconnecting',
  /** 错误：渠道发生错误，无法正常运行 */
  ERROR = 'error',
  /** 已停止：渠道已停止，不再运行 */
  STOPPED = 'stopped',
}

/** 渠道消息统计 */
export interface ChannelStats {
  /** 接收消息总数 */
  messagesReceived: number;
  /** 发送消息总数 */
  messagesSent: number;
  /** 接收消息失败次数 */
  receiveErrors: number;
  /** 发送消息失败次数 */
  sendErrors: number;
  /** 最后接收消息时间 */
  lastMessageReceivedAt?: number;
  /** 最后发送消息时间 */
  lastMessageSentAt?: number;
}

/** 渠道状态信息 */
export interface ChannelStatus {
  /** 当前生命周期状态 */
  state: ChannelLifecycleState;
  /** 渠道 ID */
  channelId: string;
  /** 渠道显示名称 */
  displayName: string;
  /** 是否正在运行（CONNECTED 状态） */
  isRunning: boolean;
  /** 启动时间戳 */
  startedAt?: number;
  /** 最后连接时间 */
  lastConnectedAt?: number;
  /** 最后断开时间 */
  lastDisconnectedAt?: number;
  /** 重连次数 */
  reconnectAttempts: number;
  /** 错误信息 */
  errorMessage?: string;
  /** 消息统计 */
  stats: ChannelStats;
}

// ═══════════════════════════════════════════════════════════════
// 渠道配置
// ═══════════════════════════════════════════════════════════════

/** 重连配置 */
export interface ReconnectConfig {
  /** 是否启用自动重连 */
  enabled: boolean;
  /** 最大重连次数（0 表示无限重连） */
  maxAttempts: number;
  /** 初始重连间隔（毫秒） */
  initialInterval: number;
  /** 最大重连间隔（毫秒） */
  maxInterval: number;
  /** 退避因子（每次重连间隔乘以此因子） */
  backoffFactor: number;
}

/** 渠道配置基类 */
export interface ChannelConfig {
  /** 渠道 ID */
  channelId: string;
  /** 是否启用 */
  enabled: boolean;
  /** 重连配置 */
  reconnect?: ReconnectConfig;
}

// ═══════════════════════════════════════════════════════════════
// 渠道运行上下文
// ═══════════════════════════════════════════════════════════════

/** 渠道日志接口 */
export interface ChannelLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * 渠道运行上下文
 * 在 start() 方法中传入，提供渠道运行所需的依赖
 */
export interface ChannelContext {
  /**
   * 消息接收回调
   * 当渠道收到新消息时，调用此回调将消息推送给 Gateway
   */
  onMessage: (message: InboundMessage) => void;

  /**
   * 错误回调
   * 当渠道发生错误时，调用此回调通知 Gateway
   */
  onError: (error: Error, channelId: string) => void;

  /**
   * 状态变更回调
   * 当渠道状态发生变化时，调用此回调通知 Gateway
   */
  onStateChange: (channelId: string, newState: ChannelLifecycleState, oldState: ChannelLifecycleState) => void;

  /** Gateway 提供的日志接口 */
  logger: ChannelLogger;
}

// ═══════════════════════════════════════════════════════════════
// 默认值
// ═══════════════════════════════════════════════════════════════

/** 默认重连配置 */
export const DEFAULT_RECONNECT_CONFIG: ReconnectConfig = {
  enabled: true,
  maxAttempts: 10,
  initialInterval: 1000,
  maxInterval: 30000,
  backoffFactor: 2,
};

/** 默认渠道统计 */
export function createDefaultChannelStats(): ChannelStats {
  return {
    messagesReceived: 0,
    messagesSent: 0,
    receiveErrors: 0,
    sendErrors: 0,
  };
}
