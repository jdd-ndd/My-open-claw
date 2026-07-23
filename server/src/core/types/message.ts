/**
 * 统一消息结构体 Message
 *
 * MyOpenClaw 全链路数据交换的标准载体。
 * 任何模块产生或消费的数据，都应先封装为 Message 再传递。
 *
 * @module @myopenclaw/server/core/types
 */

/**
 * 消息类型枚举
 * - text:       纯文本消息（最常见）
 * - image:      图片消息（含 URL 或 base64）
 * - audio:      语音消息
 * - video:      视频消息
 * - file:       文件消息
 * - system:     系统消息（不展示给用户，用于内部状态同步）
 * - tool_call:  工具调用请求（Agent 发起）
 * - tool_result:工具执行结果（Tools 层返回）
 * - error:      错误消息（系统内部错误通知）
 * - control:    控制消息（心跳、取消信号等控制面指令）
 */
export type MessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'file'
  | 'system'
  | 'tool_call'
  | 'tool_result'
  | 'error'
  | 'control';

/**
 * 消息发送者角色
 * - user:   终端用户
 * - agent:  AI Agent
 * - tool:   工具执行器
 * - system: 系统进程
 */
export type MessageRole = 'user' | 'agent' | 'tool' | 'system';

/** 附件结构体 */
export interface MessageAttachment {
  id: string;
  type: 'image' | 'audio' | 'video' | 'file';
  url?: string;
  data?: string;
  mimeType: string;
  filename?: string;
  size?: number;
  metadata?: Record<string, unknown>;
}

/** 工具调用载荷 */
export interface ToolCallPayload {
  toolName: string;
  arguments: Record<string, unknown>;
  callId: string;
}

/** 工具结果载荷 */
export interface ToolResultPayload {
  callId: string;
  result: unknown;
  success: boolean;
  error?: string;
  durationMs?: number;
}

/**
 * 统一消息结构体 Message
 */
export interface Message {
  /** 消息全局唯一 ID（ulid，26 位字符） */
  id: string;
  /** 渠道 ID */
  channelId: string;
  /** 用户 ID */
  userId: string;
  /** 会话 ID */
  sessionId: string;
  /** 消息类型 */
  type: MessageType;
  /** 发送者角色 */
  role: MessageRole;
  /** 消息文本内容 */
  content: string;
  /** 附件列表（默认 []） */
  attachments: MessageAttachment[];
  /** 生成时间戳（Unix 毫秒） */
  timestamp: number;
  /** 扩展元数据 */
  metadata: Record<string, unknown>;
  /** 工具调用载荷（type === 'tool_call' 时填充） */
  toolCall?: ToolCallPayload;
  /** 工具结果载荷（type === 'tool_result' 时填充） */
  toolResult?: ToolResultPayload;
  /** 父消息 ID（消息树追溯） */
  parentMessageId?: string;
  /** 引用的消息 ID 列表 */
  referencedMessageIds?: string[];
  /** 消息优先级（0-9，默认 5） */
  priority?: number;
  /** 消息 TTL（毫秒），超时后 Agent 不再处理 */
  ttl?: number;
}
