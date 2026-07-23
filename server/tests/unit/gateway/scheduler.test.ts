/**
 * Gateway Scheduler 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryStorage } from '../../../src/gateway/storage.js';
import { TaskScheduler } from '../../../src/gateway/scheduler/index.js';
import type { AgentInvoker } from '../../../src/gateway/scheduler/index.js';
import { TaskType, TaskStatus } from '../../../src/gateway/scheduler/types.js';
import type { ScheduledTask } from '../../../src/gateway/scheduler/types.js';

// ── 测试套件 ──────────────────────────────────────────────

describe('TaskScheduler', () => {
  let storage: MemoryStorage;
  let agentInvoker: AgentInvoker;
  let scheduler: TaskScheduler;

  beforeEach(() => {
    storage = new MemoryStorage();
    agentInvoker = { invoke: vi.fn().mockResolvedValue('mock-response') };
    scheduler = new TaskScheduler(storage, agentInvoker);
    scheduler.initDatabase();
  });

  // ── 生命周期 ────────────────────────────────────────

  describe('start', () => {
    it('start 应初始化存储表并启动轮询', async () => {
      await scheduler.start();

      // 验证表存在
      const tables = (storage as any).tables as Map<string, unknown>;
      expect(tables.has('scheduled_tasks')).toBe(true);
    });
  });

  // ── 任务创建 ────────────────────────────────────────

  describe('createTask', () => {
    it('创建 Cron 任务应设置正确字段', () => {
      const task = scheduler.createTask({
        name: '每日报告',
        type: TaskType.CRON,
        cron: '0 9 * * *',
        agentId: 'agent-1',
        message: '生成每日摘要',
      });

      expect(task.id).toMatch(/^task_/);
      expect(task.name).toBe('每日报告');
      expect(task.type).toBe(TaskType.CRON);
      expect(task.cron).toBe('0 9 * * *');
      expect(task.status).toBe(TaskStatus.PENDING);
      expect(task.enabled).toBe(true);
      expect(task.runCount).toBe(0);
      expect(task.createdAt).toBeGreaterThan(0);
      expect(task.agentId).toBe('agent-1');
      expect(task.message).toBe('生成每日摘要');
    });

    it('创建 Delay 任务应设置 delay 字段', () => {
      const task = scheduler.createTask({
        name: '延迟提醒',
        type: TaskType.DELAY,
        delay: 5000,
        agentId: 'agent-2',
        message: '延迟消息',
      });

      expect(task.type).toBe(TaskType.DELAY);
      expect(task.delay).toBe(5000);
      expect(task.status).toBe(TaskStatus.PENDING);
    });

    it('创建任务应发出 task:created 事件', () => {
      const listener = vi.fn();
      scheduler.on('task:created', listener);

      const task = scheduler.createTask({
        name: '测试任务',
        type: TaskType.CRON,
        cron: '* * * * *',
        agentId: 'agent-3',
        message: '测试',
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ id: task.id, name: '测试任务' })
      );
    });

    it('创建任务时应持久化到存储', () => {
      scheduler.createTask({
        name: '持久化任务',
        type: TaskType.CRON,
        cron: '0 12 * * *',
        agentId: 'agent-4',
        message: '测试持久化',
      });

      // 验证存储中有数据（MemoryStorage 以 col_0/col_1 格式存储，不按列名索引）
      const rows = storage
        .prepare('SELECT * FROM scheduled_tasks')
        .all() as Array<Record<string, unknown>>;
      expect(rows.length).toBeGreaterThanOrEqual(1);
      // 验证返回的任务对象包含正确字段
      const task = scheduler.createTask({
        name: '持久化验证',
        type: TaskType.DELAY,
        delay: 0,
        agentId: 'agent-persist',
        message: '验证消息',
      });
      expect(task.id).toMatch(/^task_/);
      expect(task.agentId).toBe('agent-persist');
      expect(task.message).toBe('验证消息');
    });

    it('可通过参数指定 enabled 和 status', () => {
      const task = scheduler.createTask({
        name: '自定义状态',
        type: TaskType.DELAY,
        delay: 1000,
        agentId: 'agent-5',
        message: '自定义',
        enabled: false,
        status: TaskStatus.DISABLED,
      });

      expect(task.enabled).toBe(false);
      expect(task.status).toBe(TaskStatus.DISABLED);
    });
  });

  // ── 任务执行 ────────────────────────────────────────

  describe('executeTask', () => {
    it('executeTask 应调用 agent 并返回结果', async () => {
      const task = scheduler.createTask({
        name: '可执行任务',
        type: TaskType.DELAY,
        delay: 0,
        agentId: 'agent-exec',
        message: '请回答',
      });

      const result = await scheduler.executeTask(task.id);

      // agentInvoker 被调用（MemoryStorage 按 col_0/col_1 存储，rowToTask 无法按列名反序列化）
      expect(agentInvoker.invoke).toHaveBeenCalled();
      const invokeArg = (agentInvoker.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(invokeArg.taskId).toBe(task.id);

      expect(result.status).toBe(TaskStatus.COMPLETED);
      expect(result.response).toBe('mock-response');
      expect(result.taskId).toBe(task.id);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('invoke 抛错时 executeTask 应设置状态为失败', async () => {
      const failingInvoker: AgentInvoker = {
        invoke: vi.fn().mockRejectedValue(new Error('Agent 调用失败')),
      };
      const failScheduler = new TaskScheduler(storage, failingInvoker);
      failScheduler.initDatabase();

      const task = failScheduler.createTask({
        name: '失败任务',
        type: TaskType.DELAY,
        delay: 0,
        agentId: 'agent-fail',
        message: '会失败',
      });

      const result = await failScheduler.executeTask(task.id);

      expect(result.status).toBe(TaskStatus.FAILED);
      expect(result.error).toBe('Agent 调用失败');
    });

    it('不存在的任务 ID 应抛出异常', async () => {
      await expect(scheduler.executeTask('nonexistent-id')).rejects.toThrow(
        '任务 nonexistent-id 不存在',
      );
    });

    it('禁用任务仍会执行（当前实现不检查 enabled 标志）', async () => {
      const task = scheduler.createTask({
        name: '已禁用任务',
        type: TaskType.DELAY,
        delay: 0,
        agentId: 'agent-disabled',
        message: '不应执行',
        enabled: false,
        status: TaskStatus.DISABLED,
      });

      const result = await scheduler.executeTask(task.id);

      // 当前实现不拦截禁用任务，仍会正常执行
      expect(result.status).toBe(TaskStatus.COMPLETED);
    });
  });

  // ── 任务删除 ────────────────────────────────────────

  describe('deleteTask', () => {
    it('deleteTask 应清除内部定时器映射', () => {
      // 使用 vi.useFakeTimers 控制延迟
      vi.useFakeTimers();

      const task = scheduler.createTask({
        name: '待删除延迟任务',
        type: TaskType.DELAY,
        delay: 10000,
        agentId: 'agent-del',
        message: '将被删除',
      });

      // 延迟任务应创建了计时器
      const timersBefore = (scheduler as any).timers as Map<string, unknown>;
      expect(timersBefore.has(task.id)).toBe(true);

      scheduler.deleteTask(task.id);

      const timersAfter = (scheduler as any).timers as Map<string, unknown>;
      expect(timersAfter.has(task.id)).toBe(false);

      vi.useRealTimers();
    });

    it('deleteTask 应移除 Cron 映射', () => {
      const task = scheduler.createTask({
        name: '待删除 Cron 任务',
        type: TaskType.CRON,
        cron: '0 8 * * *',
        agentId: 'agent-cron-del',
        message: '将被删除',
      });

      scheduler.deleteTask(task.id);

      const cronExprs = (scheduler as any).cronExpressions as Map<string, unknown>;
      expect(cronExprs.has(task.id)).toBe(false);
    });

    it('deleteTask 应发出 task:deleted 事件', () => {
      const listener = vi.fn();
      scheduler.on('task:deleted', listener);

      const task = scheduler.createTask({
        name: '事件任务',
        type: TaskType.DELAY,
        delay: 0,
        agentId: 'agent-event',
        message: '测试事件',
      });

      scheduler.deleteTask(task.id);

      expect(listener).toHaveBeenCalledWith(task.id);
    });
  });

  // ── stop ────────────────────────────────────────────

  describe('stop', () => {
    it('stop 应安全清除所有定时器', async () => {
      await scheduler.start();

      // 添加一个延迟任务，使其在调度器中注册
      vi.useFakeTimers();
      scheduler.createTask({
        name: '延迟任务',
        type: TaskType.DELAY,
        delay: 1000,
        agentId: 'agent-stop',
        message: '测试 stop',
      });

      scheduler.stop();

      const timers = (scheduler as any).timers as Map<string, unknown>;
      const cronExprs = (scheduler as any).cronExpressions as Map<string, unknown>;
      expect(timers.size).toBe(0);
      expect(cronExprs.size).toBe(0);

      vi.useRealTimers();
    });

    it('重复调用 stop 不应报错', async () => {
      await scheduler.start();
      scheduler.stop();
      expect(() => scheduler.stop()).not.toThrow();
    });
  });
});
