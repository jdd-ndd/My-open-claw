/**
 * Gateway Router 模块类型定义
 *
 * 定义消息路由所需的标准化消息、路由规则、会话等核心类型。
 * 所有经过 Gateway 的消息都会被规范化为 NormalizedMessage 后再进行路由分发。
 *
 * @module @myopenclaw/server/gateway/router
 */

/**
 * 消息附件结构体
 *
 * 用于描述消息中携带的媒体或文件附件信息。
 * 附件类型包括图片、文件、音频和视频。
 */
export interface MessageAttachment {
  /** 附件类型 */
  type: 'image' | 'file' | 'audio' | 'video';
  /** 附件访问 URL */
  url: string;
  /** 原始文件名（可选） */
  filename?: string;
  /** 文件大小（字节，可选） */
  size?: number;
  /** MIME 类型（可选） */
  mimeType?: string;
}

/**
 * 标准化消息结构体
 *
 * 所有来自不同渠道（WebChat、Telegram、飞书等）的原始消息，
 * 都会先被转换为 NormalizedMessage 再进行路由处理。
 * raw 字段保留原始消息数据以便下游按需使用。
 */
export interface NormalizedMessage {
  /** 消息全局唯一 ID */
  messageId: string;
  /** 来源渠道 ID */
  channelId: string;
  /** 发送用户 ID */
  userId: string;
  /** 发送用户名称（可选） */
  userName?: string;
  /** 消息文本内容 */
  content: string;
  /** 消息类型 */
  messageType: 'text' | 'image' | 'file' | 'audio' | 'video';
  /** 附件列表（可选） */
  attachments?: MessageAttachment[];
  /** 保留原始渠道消息数据 */
  raw: unknown;
  /** 消息时间戳（Unix 毫秒） */
  timestamp: number;
}

/**
 * 路由规则结构体
 *
 * 每条规则定义了将特定渠道/用户/内容的消息路由到指定 Agent 的条件。
 * 规则按 priority 升序匹配，数字越小优先级越高。
 */
export interface RoutingRule {
  /** 规则唯一 ID */
  id: string;
  /** 优先级（数字越小越优先） */
  priority: number;
  /** 匹配的渠道 ID（'*' 表示匹配所有渠道） */
  channelId: string;
  /** 匹配的用户 ID 列表（'*' 表示匹配所有用户） */
  userIds: string[];
  /** 可选的内容正则模式匹配 */
  contentPattern?: string;
  /** 目标 Agent ID */
  agentId: string;
  /** 规则是否启用 */
  enabled: boolean;
}

/**
 * 会话结构体
 *
 * 表示一个用户在一个渠道上与某个 Agent 之间的对话会话。
 * 支持 active（活跃）、idle（空闲）、closed（已关闭）三种状态。
 */
export interface Session {
  /** 会话唯一 ID */
  sessionId: string;
  /** 渠道 ID */
  channelId: string;
  /** 用户 ID */
  userId: string;
  /** 绑定的 Agent ID */
  agentId: string;
  /** 会话创建时间（Unix 毫秒） */
  createdAt: number;
  /** 最后活跃时间（Unix 毫秒） */
  lastActiveAt: number;
  /** 会话状态 */
  status: 'active' | 'idle' | 'closed';
  /** 消息 ID 列表（按插入顺序） */
  messageIds: string[];
  /** 扩展元数据（可选） */
  metadata?: Record<string, unknown>;
}

/**
 * 路由结果结构体
 *
 * 路由匹配完成后返回的结果，包含匹配状态、目标 Agent ID、
 * 关联的会话和标准化消息等完整上下文。
 */
export interface RouteResult {
  /** 是否成功匹配到路由规则 */
  matched: boolean;
  /** 匹配到的目标 Agent ID（未匹配时为 undefined） */
  agentId?: string;
  /** 当前会话（新建或已有） */
  session?: Session;
  /** 标准化后待分发的消息 */
  message?: NormalizedMessage;
  /** 未匹配时的原因说明 */
  reason?: string;
}
