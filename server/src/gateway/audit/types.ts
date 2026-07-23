/**
 * 审计日志类型定义
 *
 * @module @myopenclaw/server/gateway/audit
 */

/** 审计日志类别 */
export const AuditCategory = {
  MESSAGE: 'message',
  ROUTE: 'route',
  AGENT: 'agent',
  TOOL: 'tool',
  LLM: 'llm',
  SECURITY: 'security',
  TASK: 'task',
  SYSTEM: 'system',
} as const;

export type AuditCategoryType = (typeof AuditCategory)[keyof typeof AuditCategory];

/** 审计日志条目 */
export interface AuditLogEntry {
  id: string;
  category: AuditCategoryType;
  event: string;
  timestamp: number;
  channelId?: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  taskId?: string;
  details: Record<string, unknown>;
  sourceIp?: string;
  duration?: number;
  success: boolean;
  error?: string;
}

/** 审计日志查询条件 */
export interface AuditLogQuery {
  category?: AuditCategoryType;
  event?: string;
  startTime?: number;
  endTime?: number;
  channelId?: string;
  agentId?: string;
  success?: boolean;
  limit?: number;
  offset?: number;
}
