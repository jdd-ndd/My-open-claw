/**
 * Gateway API 类型定义
 *
 * 定义 CLI 客户端与 Gateway 通信所需的所有类型，包括：
 * - HTTP API 响应结构（适配 Gateway 的 { ok, data } 封装格式）
 * - WebSocket 消息协议（RequestMessage/ResponseMessage/EventMessage）
 * - 业务实体类型（会话、Agent、状态等）
 *
 * @module cli/api
 */

// ═══════════════════════════════════════
// HTTP API 响应类型
// ═══════════════════════════════════════

/**
 * Gateway HTTP API 统一响应格式
 *
 * 所有 Gateway HTTP 端点都遵循此响应格式：
 * - 成功响应：{ ok: true, data: {...} }
 * - 错误响应：{ ok: false, error: { code, message, retryable } }
 */
export interface ApiResponse<T = unknown> {
  /** 请求是否成功 */
  ok: boolean;
  /** 响应数据（成功时） */
  data?: T;
  /** 错误信息（失败时） */
  error?: ApiError;
}

/**
 * API 错误信息
 */
export interface ApiError {
  /** 错误代码 */
  code: number;
  /** 错误消息 */
  message: string;
  /** 是否可以重试 */
  retryable: boolean;
}

/**
 * 分页请求参数
 */
export interface PaginationParams {
  /** 偏移量 */
  offset?: number;
  /** 每页数量 */
  limit?: number;
}

// ═══════════════════════════════════════
// WebSocket 协议类型
// ═══════════════════════════════════════

/** 消息方向/类型枚举 */
export const MessageType = {
  REQUEST: 'request',
  RESPONSE: 'response',
  EVENT: 'event',
  PING: 'ping',
  PONG: 'pong',
} as const;

/** WebSocket 消息类型 */
export type MessageTypeType = (typeof MessageType)[keyof typeof MessageType];

/** 基础消息接口 */
export interface BaseMessage {
  /** 消息类型 */
  type: MessageTypeType;
  /** 消息唯一 ID */
  id: string;
  /** 消息时间戳 */
  timestamp: string;
}

/** 请求消息（客户端 → 服务端） */
export interface RequestMessage extends BaseMessage {
  type: 'request';
  /** 请求动作 */
  action: string;
  /** 请求负载 */
  payload: Record<string, unknown>;
}

/** 响应消息（服务端 → 客户端，对请求的响应） */
export interface ResponseMessage extends BaseMessage {
  type: 'response';
  /** 对应的请求 ID */
  requestId: string;
  /** 响应状态 */
  status: 'success' | 'error';
  /** 响应负载 */
  payload: Record<string, unknown>;
  /** 错误代码（失败时） */
  errorCode?: string;
  /** 错误消息（失败时） */
  errorMessage?: string;
}

/** 事件消息（服务端 → 客户端，流式事件推送） */
export interface EventMessage extends BaseMessage {
  type: 'event';
  /** 事件名称 */
  event: string;
  /** 事件负载 */
  payload: Record<string, unknown>;
}

/** Ping/Pong 消息（用于心跳检测） */
export interface PingMessage extends BaseMessage {
  type: 'ping';
}

export interface PongMessage extends BaseMessage {
  type: 'pong';
}

/** Gateway 消息联合类型 */
export type GatewayMessage = RequestMessage | ResponseMessage | EventMessage | PingMessage | PongMessage;

// ═══════════════════════════════════════
// 业务实体类型
// ═══════════════════════════════════════

/** 会话信息 */
export interface SessionInfo {
  /** 会话 ID */
  sessionId: string;
  /** 会话状态 */
  status: string;
  /** 创建时间 */
  createdAt: string;
  /** 最后活跃时间 */
  lastActiveAt?: string;
  /** 消息数量 */
  messageCount?: number;
  /** 会话标题 */
  title?: string;
}

/** 会话列表项 */
export interface SessionListItem {
  /** 会话 ID */
  id: string;
  /** 会话标题 */
  title: string;
  /** 消息数量 */
  messageCount: number;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
  /** 会话状态 */
  status: string;
}

/** Agent 运行状态 */
export interface AgentStatus {
  /** Agent ID */
  agentId: string;
  /** 运行状态 */
  status: string;
  /** 最后活跃时间 */
  lastActiveAt: string;
  /** 统计信息 */
  stats?: Record<string, unknown>;
}

/** Gateway 系统状态 */
export interface SystemStatus {
  /** 网关状态 */
  status: 'running' | 'stopped' | 'degraded';
  /** 运行时间（秒） */
  uptime: number;
  /** 连接数量 */
  connectionCount: number;
  /** 最大连接数 */
  maxConnections: number;
  /** 活跃会话数 */
  activeSessions: number;
  /** 规则数量 */
  ruleCount: number;
  /** 主机地址 */
  host: string;
  /** 端口 */
  port: number;
  /** 版本号 */
  version: string;
  /** 内存使用 */
  memoryUsage?: Record<string, unknown>;
  /** 渠道数量 */
  channels: number;
  /** Agent 列表 */
  agents?: AgentStatus[];
}

/** 健康检查响应 */
export interface HealthCheck {
  /** 服务状态 */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** 各组件状态 */
  components?: Record<string, string>;
  /** 运行时间（秒） */
  uptime?: number;
}

/** 审计日志条目 */
export interface AuditLogEntry {
  /** 日志 ID */
  id: string;
  /** 类别 */
  category: string;
  /** 事件名称 */
  event: string;
  /** 会话 ID */
  sessionId?: string;
  /** 状态 */
  success: boolean;
  /** 时间戳 */
  timestamp: string;
  /** 详情 */
  details?: Record<string, unknown>;
}

/** 工具信息 */
export interface ToolInfo {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** 工具版本 */
  version?: string;
  /** 参数 Schema */
  parameters?: Record<string, unknown>;
}

/** 技能信息 */
export interface SkillInfo {
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 技能版本 */
  version?: string;
  /** 触发条件 */
  triggers?: string[];
}

/** 聊天消息 */
export interface ChatMessage {
  /** 消息内容 */
  content: string;
  /** 会话 ID */
  sessionId?: string;
  /** 使用的模型 */
  model?: string;
  /** 渠道 ID */
  channelId?: string;
  /** 是否使用流式输出 */
  stream?: boolean;
  /** 附件列表 */
  attachments?: AttachmentInfo[];
}

/** 文件附件信息 */
export interface AttachmentInfo {
  /** 文件名 */
  name: string;
  /** 文件 URL 或路径 */
  url: string;
  /** 文件大小（字节） */
  size: number;
  /** MIME 类型 */
  mimeType?: string;
}

/** 聊天流式响应事件 */
export const ChatEvent = {
  /** 流式内容块 */
  DELTA: 'chat.delta',
  /** 推理内容块 */
  REASONING_DELTA: 'chat.reasoning_delta',
  /** 流式完成 */
  DONE: 'chat.done',
} as const;

/** 聊天完成事件负载 */
export interface ChatDonePayload {
  /** 会话 ID */
  sessionId: string;
  /** 消息 ID */
  messageId: string;
  /** 完整回复内容 */
  totalContent: string;
  /** 推理内容 */
  totalReasoning?: string;
  /** 推理耗时（毫秒） */
  reasoningDurationMs?: number;
  /** 总耗时（毫秒） */
  durationMs: number;
  /** 是否发生错误 */
  error?: boolean;
}

/** 聊天增量事件负载 */
export interface ChatDeltaPayload {
  /** 会话 ID */
  sessionId: string;
  /** 增量内容 */
  delta: string;
  /** 累积内容 */
  accumulated: string;
}
