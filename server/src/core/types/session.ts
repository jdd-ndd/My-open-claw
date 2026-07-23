/**
 * 会话 Session 类型定义
 *
 * @module @myopenclaw/server/core/types
 */

/** 会话状态枚举 */
export type SessionStatus = 'active' | 'idle' | 'paused' | 'closing' | 'closed' | 'error';

/** 会话配置（创建时确定，运行期只读） */
export interface SessionConfig {
  agentId: string;
  model?: string;
  systemPrompt?: string;
  memoryWindowSize?: number;
  longTermMemoryEnabled?: boolean;
  allowedTools?: string[];
  temperature?: number;
  maxTokens?: number;
  idleTimeout?: number;
  maxLifetime?: number;
  metadata?: Record<string, unknown>;
}

/** 会话统计信息 */
export interface SessionStats {
  messageCount: number;
  toolCallCount: number;
  totalTokens: number;
  totalLatencyMs: number;
  firstMessageAt?: number;
  lastMessageAt?: number;
}

/** 会话 Session 结构体 */
export interface Session {
  id: string;
  userId: string;
  channelId: string;
  title?: string;
  status: SessionStatus;
  config: SessionConfig;
  stats: SessionStats;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
  closedAt?: number;
  metadata: Record<string, unknown>;
  closeReason?: string;
  error?: string;
}
