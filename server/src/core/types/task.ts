/**
 * 任务 Task 类型定义
 *
 * @module @myopenclaw/server/core/types
 */

/** 任务状态枚举 */
export type TaskStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

/** 任务步骤（ReAct 循环的每一步） */
export interface TaskStep {
  id: string;
  index: number;
  kind: 'thought' | 'action' | 'observation';
  content: string;
  messageId?: string;
  toolCallId?: string;
  startedAt: number;
  endedAt?: number;
}

/** 任务 Task 结构体 */
export interface Task {
  id: string;
  sessionId: string;
  triggerMessageId: string;
  parentTaskId?: string;
  goal: string;
  status: TaskStatus;
  steps: TaskStep[];
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  result?: string;
  error?: string;
  metadata: Record<string, unknown>;
  priority?: number;
  retryCount?: number;
  maxRetries?: number;
}
