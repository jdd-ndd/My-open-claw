/**
 * TaskScheduler - 定时任务调度器
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '../../core/utils/logger.js';
import type { MemoryStorage, StorageRow } from '../core/storage.js';
import {
  TaskType,
  TaskStatus,
  type ScheduledTask,
  type TaskExecutionResult,
} from './types.js';

const log = createLogger('gateway:scheduler');

export interface AgentInvoker {
  invoke(params: {
    agentId: string;
    message: string;
    channelId?: string;
    userId?: string;
    taskId?: string;
  }): Promise<string>;
}

export class TaskScheduler extends EventEmitter {
  private timers = new Map<string, NodeJS.Timeout>();
  private cronExpressions = new Map<string, string>();
  private cronCheckInterval?: ReturnType<typeof setInterval>;
  private _agentInvoker: AgentInvoker;

  constructor(
    private storage: MemoryStorage,
    agentInvoker: AgentInvoker,
  ) {
    super();
    this._agentInvoker = agentInvoker;
  }

  listTasks(): ScheduledTask[] {
    const rows = this.storage.prepare('SELECT * FROM scheduled_tasks ORDER BY createdAt DESC').all() as StorageRow[];
    return rows.map((row) => this.rowToTask(row));
  }

  setAgentInvoker(invoker: AgentInvoker): void {
    this._agentInvoker = invoker;
    log.info('调度器 AgentInvoker 已更新');
  }

  initDatabase(): void {
    this.storage.ensureTable('scheduled_tasks', `
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
      duration INTEGER,
      metadata TEXT
    `);
  }

  async start(): Promise<void> {
    log.info('定时任务调度器正在启动...');

    const rows = this.storage.prepare('SELECT * FROM scheduled_tasks').all() as StorageRow[];
    for (const row of rows) {
      if (row.enabled === 1 && row.type === 'cron') {
        const task = this.rowToTask(row);
        if (task.cron) {
          this.cronExpressions.set(task.id, task.cron);
        }
      }
    }

    this.cronCheckInterval = setInterval(() => {
      this.checkCronTasks().catch((err) => {
        log.error({ err }, 'Cron 任务轮询出错');
      });
    }, 60_000);

    log.info({ cronCount: this.cronExpressions.size }, '调度器已启动');
  }

  async stop(): Promise<void> {
    if (this.cronCheckInterval) {
      clearInterval(this.cronCheckInterval);
      this.cronCheckInterval = undefined;
    }

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
    this.cronExpressions.clear();
    log.info('调度器已停止');
  }

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

    this.persistTask(fullTask);

    if (fullTask.enabled) {
      this.schedule(fullTask);
    }

    log.info({ taskId: id, type: fullTask.type }, '任务已创建');
    this.emit('task:created', fullTask);
    return fullTask;
  }

  deleteTask(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }

    this.cronExpressions.delete(taskId);
    this.storage.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(taskId);
    log.info({ taskId }, '任务已删除');
    this.emit('task:deleted', taskId);
  }

  async executeTask(taskId: string): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    const row = this.storage.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as StorageRow | undefined;

    if (!row) {
      throw new Error(`任务 ${taskId} 不存在`);
    }

    const task = this.rowToTask(row);
    this.updateTaskStatus(taskId, TaskStatus.RUNNING);

    try {
      log.info({ taskId, agentId: task.agentId }, '开始执行任务');

      const response = await this._agentInvoker.invoke({
        agentId: task.agentId,
        message: task.message,
        channelId: task.channelId,
        userId: task.userId,
        taskId,
      });

      const duration = Date.now() - startTime;
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

  private schedule(task: ScheduledTask): void {
    if (task.type === TaskType.CRON) {
      this.scheduleCronTask(task);
      return;
    }

    if (task.type === TaskType.DELAY) {
      this.scheduleDelayTask(task);
    }
  }

  private scheduleCronTask(task: ScheduledTask): void {
    if (task.cron) {
      this.cronExpressions.set(task.id, task.cron);
      log.debug({ taskId: task.id, cron: task.cron }, 'Cron 任务已注册');
    }
  }

  private scheduleDelayTask(task: ScheduledTask): void {
    if (!task.delay || task.delay <= 0) {
      void this.executeTask(task.id);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(task.id);
      void this.executeTask(task.id);
    }, task.delay);

    this.timers.set(task.id, timer);
    log.debug({ taskId: task.id, delay: task.delay }, '延迟任务已注册');
  }

  private async checkCronTasks(): Promise<void> {
    const now = new Date();

    for (const [taskId, cronExpr] of this.cronExpressions) {
      if (!this.matchesCron(now, cronExpr)) {
        continue;
      }

      const taskRow = this.storage.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as StorageRow | undefined;
      if (!taskRow) {
        continue;
      }

      const lastRunAt = taskRow.lastRunAt as number | undefined;
      const currentMinute = Math.floor(Date.now() / 60_000);
      const lastMinute = lastRunAt ? Math.floor(lastRunAt / 60_000) : 0;

      if (lastMinute < currentMinute) {
        await this.executeTask(taskId);
      }
    }
  }

  private matchesCron(now: Date, cronExpr: string): boolean {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length !== 5) {
      return false;
    }

    const [minute, hour, day, month, weekDay] = parts;
    return this.matchesCronField(now.getMinutes(), minute)
      && this.matchesCronField(now.getHours(), hour)
      && this.matchesCronField(now.getDate(), day)
      && this.matchesCronField(now.getMonth() + 1, month)
      && this.matchesCronField(now.getDay(), weekDay);
  }

  private matchesCronField(value: number, expr: string): boolean {
    if (expr === '*') {
      return true;
    }

    if (expr.includes(',')) {
      return expr.split(',').some((part) => this.matchesCronField(value, part));
    }

    if (expr.startsWith('*/')) {
      const step = Number(expr.slice(2));
      return step > 0 && value % step === 0;
    }

    const parsed = Number(expr);
    return Number.isFinite(parsed) && parsed === value;
  }

  private updateTaskStatus(taskId: string, status: TaskStatus): void {
    this.storage.prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ?').run(status, taskId);
  }

  private updateTaskRunInfo(taskId: string, duration: number): void {
    const now = Date.now();
    this.storage
      .prepare('UPDATE scheduled_tasks SET lastRunAt = ?, runCount = runCount + 1, duration = ? WHERE id = ?')
      .run(now, duration, taskId);
  }

  private persistTask(task: ScheduledTask): void {
    this.storage
      .prepare(`INSERT INTO scheduled_tasks (id, name, type, cron, delay, agentId, message, channelId, userId, status, enabled, createdAt, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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

  private rowToTask(row: StorageRow): ScheduledTask {
    let metadata: Record<string, unknown> | undefined;
    const metadataRaw = row.metadata;
    if (typeof metadataRaw === 'string') {
      try {
        metadata = JSON.parse(metadataRaw);
      } catch {
        metadata = undefined;
      }
    }

    return {
      id: String(row.id ?? ''),
      name: String(row.name ?? ''),
      type: (row.type as TaskType) ?? TaskType.CRON,
      cron: row.cron ? String(row.cron) : undefined,
      delay: row.delay ? Number(row.delay) : undefined,
      agentId: String(row.agentId ?? ''),
      message: String(row.message ?? ''),
      channelId: row.channelId ? String(row.channelId) : undefined,
      userId: row.userId ? String(row.userId) : undefined,
      status: (row.status as TaskStatus) ?? TaskStatus.PENDING,
      enabled: row.enabled === 1 || row.enabled === true,
      createdAt: Number(row.createdAt ?? 0),
      lastRunAt: row.lastRunAt ? Number(row.lastRunAt) : undefined,
      nextRunAt: row.nextRunAt ? Number(row.nextRunAt) : undefined,
      runCount: Number(row.runCount ?? 0),
      metadata,
    };
  }
}
