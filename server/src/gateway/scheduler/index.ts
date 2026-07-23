/**
 * TaskScheduler —— 定时任务调度器
 *
 * 支持 Cron 定时任务和 Delay 延迟任务两种类型，
 * 持久化到 MemoryStorage，通过 AgentInvoker 执行任务。
 *
 * @module @myopenclaw/server/gateway
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '../../core/utils/logger.js';
import type { MemoryStorage, StorageRow } from '../storage.js';
import {
  TaskType,
  TaskStatus,
  type ScheduledTask,
  type TaskExecutionResult,
} from './types.js';

const log = createLogger('gateway:scheduler');

/** Agent 调用器接口 */
export interface AgentInvoker {
  /**
   * 调用 Agent 执行任务
   * @param params - 调用参数
   * @returns Agent 返回的响应字符串
   */
  invoke(params: {
    agentId: string;
    message: string;
    channelId?: string;
    userId?: string;
    taskId?: string;
  }): Promise<string>;
}

export class TaskScheduler extends EventEmitter {
  /** 延迟任务定时器映射（taskId → timeout） */
  private timers = new Map<string, NodeJS.Timeout>();

  /** Cron 表达式映射（taskId → cron 表达式字符串） */
  private cronExpressions = new Map<string, string>();

  /** Cron 轮询检查定时器 */
  private cronCheckInterval?: ReturnType<typeof setInterval>;

  /**
   * 创建任务调度器实例
   * @param storage - 内存存储适配器
   * @param agentInvoker - Agent 调用器实例
   */
  constructor(
    private storage: MemoryStorage,
    private agentInvoker: AgentInvoker,
  ) {
    super();
  }

  // ==================== 数据库初始化 ====================

  /**
   * 初始化数据库表结构
   */
  initDatabase(): void {
    this.storage.ensureTable(
      'scheduled_tasks',
      `
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          cron TEXT,
          delay INTEGER,
          agentId TEXT NOT NULL,
          message TEXT NOT NULL,
          channelId TEXT,
          userId TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          enabled INTEGER NOT NULL DEFAULT 1,
          createdAt INTEGER NOT NULL,
          lastRunAt INTEGER,
          nextRunAt INTEGER,
          runCount INTEGER NOT NULL DEFAULT 0,
          metadata TEXT
        )
      `,
    );
  }

  // ==================== 生命周期 ====================

  /**
   * 启动调度器：从存储加载启用的 Cron 任务并开始轮询
   */
  async start(): Promise<void> {
    log.info('定时任务调度器正在启动...');

    // 加载所有已启用的 Cron 任务
    const rows = this.storage
      .prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1 AND type = ?')
      .all('cron') as StorageRow[];

    for (const row of rows) {
      const task = this.rowToTask(row);
      if (task.cron) {
        this.cronExpressions.set(task.id, task.cron);
        log.debug({ taskId: task.id, cron: task.cron }, '已加载 Cron 任务');
      }
    }

    // 启动 60 秒轮询检查
    this.cronCheckInterval = setInterval(() => {
      this.checkCronTasks().catch((err) => {
        log.error({ err }, 'Cron 任务轮询出错');
      });
    }, 60_000);

    log.info({ cronCount: this.cronExpressions.size }, '调度器已启动');
  }

  /**
   * 停止调度器：清除所有定时器和轮询
   */
  stop(): void {
    if (this.cronCheckInterval) {
      clearInterval(this.cronCheckInterval);
      this.cronCheckInterval = undefined;
    }

    // 清除所有延迟任务定时器
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.cronExpressions.clear();

    log.info('调度器已停止');
  }

  // ==================== 任务管理 ====================

  /**
   * 创建并注册调度任务
   * @param task - 任务定义（不含 id、status、createdAt 等自动生成字段）
   * @returns 创建后的完整任务对象
   */
  createTask(task: Omit<ScheduledTask, 'id' | 'status' | 'createdAt' | 'runCount' | 'enabled'> & { enabled?: boolean; status?: TaskStatus }): ScheduledTask {
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = Date.now();

    const fullTask: ScheduledTask = {
      id,
      name: task.name,
      type: task.type,
      cron: task.cron,
      delay: task.delay,
      agentId: task.agentId,
      message: task.message,
      channelId: task.channelId,
      userId: task.userId,
      status: task.status ?? TaskStatus.PENDING,
      enabled: task.enabled ?? true,
      createdAt: now,
      runCount: 0,
      metadata: task.metadata,
    };

    // 持久化到存储
    this.persistTask(fullTask);

    // 根据类型进行调度
    if (fullTask.enabled) {
      this.schedule(fullTask);
    }

    log.info({ taskId: id, type: fullTask.type }, '任务已创建');
    this.emit('task:created', fullTask);
    return fullTask;
  }

  /**
   * 删除指定任务
   * @param taskId - 任务唯一标识
   */
  deleteTask(taskId: string): void {
    // 清除定时器
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }

    // 移除 Cron 映射
    this.cronExpressions.delete(taskId);

    // 从存储中删除
    this.storage.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(taskId);

    log.info({ taskId }, '任务已删除');
    this.emit('task:deleted', taskId);
  }

  // ==================== 任务调度 ====================

  /**
   * 根据任务类型进行调度
   * @param task - 调度任务
   */
  private schedule(task: ScheduledTask): void {
    if (task.type === TaskType.CRON) {
      this.scheduleCronTask(task);
    } else if (task.type === TaskType.DELAY) {
      this.scheduleDelayTask(task);
    }
  }

  /**
   * 注册 Cron 定时任务
   * @param task - Cron 类型调度任务
   */
  scheduleCronTask(task: ScheduledTask): void {
    if (task.cron) {
      this.cronExpressions.set(task.id, task.cron);
      log.debug({ taskId: task.id, cron: task.cron }, 'Cron 任务已注册');
    }
  }

  /**
   * 注册延迟执行任务
   * @param task - Delay 类型调度任务
   */
  scheduleDelayTask(task: ScheduledTask): void {
    if (!task.delay || task.delay <= 0) {
      // 无延迟或延迟已过期，立即执行
      log.debug({ taskId: task.id }, '延迟任务立即执行');
      this.executeTask(task.id).catch((err) => {
        log.error({ err, taskId: task.id }, '延迟任务执行失败');
      });
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(task.id);
      this.executeTask(task.id).catch((err) => {
        log.error({ err, taskId: task.id }, '延迟任务执行失败');
      });
    }, task.delay);

    this.timers.set(task.id, timer);
    log.debug({ taskId: task.id, delay: task.delay }, '延迟任务已注册');
  }

  // ==================== Cron 轮询检查 ====================

  /**
   * 检查所有 Cron 任务是否到达执行时间
   */
  private async checkCronTasks(): Promise<void> {
    const now = new Date();

    for (const [taskId, cronExpr] of this.cronExpressions) {
      if (this.matchesCron(now, cronExpr)) {
        // 防止重复执行：检查上次执行时间是否在同一分钟内
        const taskRow = this.storage
          .prepare('SELECT * FROM scheduled_tasks WHERE id = ?')
          .get(taskId) as StorageRow | undefined;

        if (taskRow) {
          const lastRunAt = taskRow['lastRunAt'] as number | undefined;
          const currentMinute = Math.floor(Date.now() / 60_000);
          const lastMinute = lastRunAt
            ? Math.floor(lastRunAt / 60_000)
            : 0;

          if (lastMinute < currentMinute) {
            log.debug({ taskId, cron: cronExpr }, 'Cron 任务触发执行');
            this.executeTask(taskId).catch((err) => {
              log.error({ err, taskId }, 'Cron 任务执行失败');
            });
          }
        }
      }
    }
  }

  /**
   * 简单 Cron 表达式匹配（支持五位格式：分 时 日 月 周）
   * @param date - 当前时间
   * @param cronExpr - Cron 表达式
   * @returns 是否匹配
   */
  private matchesCron(date: Date, cronExpr: string): boolean {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) return false;

    const current = [
      date.getMinutes(),
      date.getHours(),
      date.getDate(),
      date.getMonth() + 1,
      date.getDay(), // 0=周日
    ];

    for (let i = 0; i < 5; i++) {
      if (!this.matchesCronField(parts[i], current[i])) {
        return false;
      }
    }

    return true;
  }

  /**
   * 检查单个 Cron 字段是否匹配当前值
   * @param field - Cron 字段值（支持 * 通配和逗号分隔的数值）
   * @param current - 当前时间对应字段的值
   * @returns 是否匹配
   */
  private matchesCronField(field: string, current: number): boolean {
    if (field === '*') return true;

    // 支持逗号分隔的多值
    const values = field.split(',');
    for (const val of values) {
      const num = parseInt(val, 10);
      if (!isNaN(num) && num === current) {
        return true;
      }
    }

    return false;
  }

  // ==================== 任务执行 ====================

  /**
   * 执行指定任务
   * @param taskId - 任务唯一标识
   * @returns 执行结果
   */
  async executeTask(taskId: string): Promise<TaskExecutionResult> {
    const startTime = Date.now();

    // 从存储加载任务
    const row = this.storage
      .prepare('SELECT * FROM scheduled_tasks WHERE id = ?')
      .get(taskId) as StorageRow | undefined;

    if (!row) {
      throw new Error(`任务 ${taskId} 不存在`);
    }

    const task = this.rowToTask(row);

    // 更新为运行中
    this.updateTaskStatus(taskId, TaskStatus.RUNNING);

    try {
      log.info({ taskId, agentId: task.agentId }, '开始执行任务');

      // 调用 Agent
      const response = await this.agentInvoker.invoke({
        agentId: task.agentId,
        message: task.message,
        channelId: task.channelId,
        userId: task.userId,
        taskId,
      });

      const duration = Date.now() - startTime;

      // 更新为完成
      this.updateTaskStatus(taskId, TaskStatus.COMPLETED);
      this.updateTaskRunInfo(taskId, duration);

      const result: TaskExecutionResult = {
        taskId,
        status: TaskStatus.COMPLETED,
        response,
        duration,
        executedAt: startTime,
      };

      this.emit('task:executed', result);
      return result;
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      // 更新为失败
      this.updateTaskStatus(taskId, TaskStatus.FAILED);
      this.updateTaskRunInfo(taskId, duration);

      log.error({ err, taskId, duration }, '任务执行失败');

      const result: TaskExecutionResult = {
        taskId,
        status: TaskStatus.FAILED,
        error: errorMessage,
        duration,
        executedAt: startTime,
      };

      this.emit('task:failed', result);
      return result;
    }
  }

  // ==================== 内部辅助 ====================

  /**
   * 更新任务状态
   * @param taskId - 任务唯一标识
   * @param status - 新状态
   */
  private updateTaskStatus(taskId: string, status: TaskStatus): void {
    this.storage
      .prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ?')
      .run(status, taskId);
  }

  /**
   * 更新任务运行信息（上次运行时间、下次运行时间、执行次数）
   * @param taskId - 任务唯一标识
   * @param duration - 本次执行耗时
   */
  private updateTaskRunInfo(taskId: string, duration: number): void {
    const now = Date.now();
    this.storage
      .prepare(
        'UPDATE scheduled_tasks SET lastRunAt = ?, runCount = runCount + 1, duration = ? WHERE id = ?',
      )
      .run(now, duration, taskId);
  }

  /**
   * 持久化任务到存储
   * @param task - 调度任务
   */
  private persistTask(task: ScheduledTask): void {
    this.storage
      .prepare(
        `INSERT INTO scheduled_tasks (id, name, type, cron, delay, agentId, message, channelId, userId, status, enabled, createdAt, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.name,
        task.type,
        task.cron ?? null,
        task.delay ?? null,
        task.agentId,
        task.message,
        task.channelId ?? null,
        task.userId ?? null,
        task.status,
        task.enabled ? 1 : 0,
        task.createdAt,
        task.metadata ? JSON.stringify(task.metadata) : null,
      );
  }

  /**
   * 将存储行转换为 ScheduledTask 对象
   * @param row - 存储行数据
   * @returns 调度任务对象
   */
  private rowToTask(row: StorageRow): ScheduledTask {
    const metadataRaw = row['metadata'];
    let metadata: Record<string, unknown> | undefined;
    if (typeof metadataRaw === 'string') {
      try {
        metadata = JSON.parse(metadataRaw);
      } catch {
        metadata = undefined;
      }
    }

    return {
      id: String(row['id'] ?? ''),
      name: String(row['name'] ?? ''),
      type: (row['type'] as TaskType) ?? TaskType.CRON,
      cron: row['cron'] ? String(row['cron']) : undefined,
      delay: row['delay'] ? Number(row['delay']) : undefined,
      agentId: String(row['agentId'] ?? ''),
      message: String(row['message'] ?? ''),
      channelId: row['channelId'] ? String(row['channelId']) : undefined,
      userId: row['userId'] ? String(row['userId']) : undefined,
      status: (row['status'] as TaskStatus) ?? TaskStatus.PENDING,
      enabled: row['enabled'] === 1 || row['enabled'] === true,
      createdAt: Number(row['createdAt'] ?? 0),
      lastRunAt: row['lastRunAt'] ? Number(row['lastRunAt']) : undefined,
      runCount: Number(row['runCount'] ?? 0),
      metadata,
    };
  }
}
