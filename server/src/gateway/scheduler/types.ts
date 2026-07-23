/**
 * Scheduler 模块类型定义
 *
 * @module @myopenclaw/server/gateway
 */

/** 任务类型枚举 */
export enum TaskType {
  /** Cron 定时任务 */
  CRON = 'cron',
  /** 延迟执行任务 */
  DELAY = 'delay',
}

/** 任务状态枚举 */
export enum TaskStatus {
  /** 等待执行 */
  PENDING = 'pending',
  /** 正在运行 */
  RUNNING = 'running',
  /** 执行完成 */
  COMPLETED = 'completed',
  /** 执行失败 */
  FAILED = 'failed',
  /** 已禁用 */
  DISABLED = 'disabled',
}

/** 调度任务定义 */
export interface ScheduledTask {
  /** 任务唯一标识 */
  id: string;
  /** 任务名称 */
  name: string;
  /** 任务类型 */
  type: TaskType;
  /** Cron 表达式（type 为 CRON 时必填） */
  cron?: string;
  /** 延迟时间，毫秒（type 为 DELAY 时必填） */
  delay?: number;
  /** 关联的 Agent ID */
  agentId: string;
  /** 发送给 Agent 的消息内容 */
  message: string;
  /** 关联的渠道 ID */
  channelId?: string;
  /** 关联的用户 ID */
  userId?: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间戳（毫秒） */
  createdAt: number;
  /** 上次执行时间戳（毫秒） */
  lastRunAt?: number;
  /** 下次执行时间戳（毫秒） */
  nextRunAt?: number;
  /** 已执行次数 */
  runCount: number;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

/** 任务执行结果 */
export interface TaskExecutionResult {
  /** 任务 ID */
  taskId: string;
  /** 执行后状态 */
  status: TaskStatus;
  /** Agent 返回的响应内容 */
  response?: string;
  /** 执行耗时（毫秒） */
  duration: number;
  /** 错误信息 */
  error?: string;
  /** 实际执行时间戳（毫秒） */
  executedAt: number;
}
