/** 消息内容块类型 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; url: string; mimeType: string }
  | { type: 'file'; name: string; url: string; size: number; mimeType: string }
  | { type: 'code'; code: string; language?: string }
  | { type: 'tool_call'; toolName: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; result: unknown; success: boolean };

/** 消息角色 */
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

/** 消息状态 */
export type MessageStatus = 'sending' | 'sent' | 'error' | 'streaming';

/** 消息元数据 */
export interface MessageMetadata {
  model?: string;
  tokensUsed?: number;
  latencyMs?: number;
}

/** 外部渠道来源信息（监控会话消息专用） */
export interface ExternalSourceInfo {
  /** 来源渠道 ID（qqbot/feishu/wechat） */
  sourceChannel?: string;
  /** 来源用户 ID（渠道内） */
  sourceUserId?: string;
  /** 来源用户名 */
  sourceUsername?: string;
  /** 来源显示名称 */
  sourceDisplayName?: string;
  /** 聊天类型 */
  chatType?: 'private' | 'group';
  /** 群组 ID */
  groupId?: string;
  /** 群组名称 */
  groupName?: string;
  /** 是否来自 Web 监控端反向推送 */
  fromWebMonitor?: boolean;
}

/** 消息对象 */
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: ContentBlock[];
  timestamp: string;
  status: MessageStatus;
  error?: string;
  reasoning?: string;
  reasoningDurationMs?: number;
  metadata?: MessageMetadata;
  /** 外部渠道来源信息（监控会话消息专用） */
  externalSource?: ExternalSourceInfo;
}
