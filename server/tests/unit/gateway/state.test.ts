/**
 * StateManager 全局状态管理器单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StateManager } from '../../../src/gateway/state/index.js';
import type { TaskState } from '../../../src/gateway/state/types.js';

function makeTask(overrides?: Partial<TaskState>): TaskState {
  return {
    taskId: 'task-001',
    name: 'test-task',
    type: 'delay',
    status: 'pending',
    agentId: 'agent-1',
    ...overrides,
  };
}

describe('Gateway - StateManager', () => {
  let manager: StateManager;

  beforeEach(() => {
    manager = new StateManager('1.0.0');
  });

  describe('构造函数', () => {
    it('应用版本号字符串初始化', () => {
      const snapshot = manager.getSnapshot();
      expect(snapshot.version).toBe('1.0.0');
    });

    it('应记录启动时间戳', () => {
      const snapshot = manager.getSnapshot();
      expect(snapshot.startedAt).toBeGreaterThan(0);
      // 启动时间应在最近 5 秒内
      expect(Date.now() - snapshot.startedAt).toBeLessThan(5000);
    });
  });

  describe('渠道状态管理', () => {
    it('updateChannelState 应创建新渠道并使用默认值', () => {
      manager.updateChannelState('discord', { status: 'connected' });

      const state = manager.getChannelState('discord');
      expect(state).toBeDefined();
      expect(state!.channelId).toBe('discord');
      expect(state!.status).toBe('connected');
      expect(state!.stats.messagesReceived).toBe(0);
      expect(state!.stats.messagesSent).toBe(0);
    });

    it('getChannelState 应返回已创建渠道的状态', () => {
      manager.updateChannelState('telegram', { status: 'connecting' });

      const state = manager.getChannelState('telegram');
      expect(state).toBeDefined();
      expect(state!.channelId).toBe('telegram');
      expect(state!.status).toBe('connecting');
    });

    it('getChannelState 不存在时应返回 undefined', () => {
      const state = manager.getChannelState('nonexistent');
      expect(state).toBeUndefined();
    });

    it('getAllChannelStates 应返回所有渠道的数组', () => {
      manager.updateChannelState('discord', { status: 'connected' });
      manager.updateChannelState('telegram', { status: 'disconnected' });

      const all = manager.getAllChannelStates();
      expect(all).toHaveLength(2);
      expect(all.map((c) => c.channelId).sort()).toEqual(['discord', 'telegram']);
    });

    it('getAllChannelStates 无渠道时应返回空数组', () => {
      const all = manager.getAllChannelStates();
      expect(all).toEqual([]);
    });
  });

  describe('Agent 状态管理', () => {
    it('updateAgentState 应创建新 Agent 条目', () => {
      manager.updateAgentState('agent-1', { status: 'busy' });

      const state = manager.getAgentState('agent-1');
      expect(state).toBeDefined();
      expect(state!.agentId).toBe('agent-1');
      expect(state!.status).toBe('busy');
      expect(state!.stats.totalInvocations).toBe(0);
    });

    it('getAgentState 应返回已创建的 Agent 状态', () => {
      manager.updateAgentState('agent-2', { status: 'idle' });

      const state = manager.getAgentState('agent-2');
      expect(state!.status).toBe('idle');
    });

    it('getAgentState 不存在时应返回 undefined', () => {
      const state = manager.getAgentState('missing-agent');
      expect(state).toBeUndefined();
    });

    it('getIdleAgents 应过滤出空闲的 Agent', () => {
      manager.updateAgentState('agent-1', { status: 'idle' });
      manager.updateAgentState('agent-2', { status: 'busy' });
      manager.updateAgentState('agent-3', { status: 'idle' });
      manager.updateAgentState('agent-4', { status: 'error' });

      const idle = manager.getIdleAgents();
      expect(idle).toHaveLength(2);
      expect(idle.map((a) => a.agentId).sort()).toEqual(['agent-1', 'agent-3']);
    });

    it('getIdleAgents 无空闲 Agent 时应返回空数组', () => {
      manager.updateAgentState('agent-1', { status: 'busy' });
      manager.updateAgentState('agent-2', { status: 'error' });

      const idle = manager.getIdleAgents();
      expect(idle).toEqual([]);
    });
  });

  describe('任务队列管理', () => {
    it('addTask 应增加 pendingCount', () => {
      const snapshot = manager.getSnapshot();
      const initialPending = snapshot.taskQueue.pendingCount;

      manager.addTask(makeTask({ taskId: 't1' }));
      manager.addTask(makeTask({ taskId: 't2' }));

      const snapshot2 = manager.getSnapshot();
      expect(snapshot2.taskQueue.pendingCount).toBe(initialPending + 2);
    });

    it('updateTaskState pending→running 应调整计数器', () => {
      manager.addTask(makeTask({ taskId: 't1', status: 'pending' }));

      manager.updateTaskState('t1', { status: 'running' });

      const snapshot = manager.getSnapshot();
      // pending 从 1 减到 0，running 从 0 增到 1
      expect(snapshot.taskQueue.pendingCount).toBe(0);
      expect(snapshot.taskQueue.runningCount).toBe(1);
    });

    it('updateTaskState running→completed 应调整计数器', () => {
      // addTask 总是增加 pendingCount，需要先 pending→running 再 running→completed
      manager.addTask(makeTask({ taskId: 't1', status: 'pending' }));
      manager.updateTaskState('t1', { status: 'running' });
      // 重置计数，便于后续断言
      manager.updateTaskState('t1', { status: 'completed' });

      const snapshot = manager.getSnapshot();
      expect(snapshot.taskQueue.pendingCount).toBe(0);
      expect(snapshot.taskQueue.runningCount).toBe(0);
      expect(snapshot.taskQueue.completedCount).toBe(1);
    });

    it('updateTaskState running→failed 应调整计数器', () => {
      // addTask 总是增加 pendingCount，需要先 pending→running 再 running→failed
      manager.addTask(makeTask({ taskId: 't1', status: 'pending' }));
      manager.updateTaskState('t1', { status: 'running' });
      // 重置计数，便于后续断言
      manager.updateTaskState('t1', { status: 'failed' });

      const snapshot = manager.getSnapshot();
      expect(snapshot.taskQueue.pendingCount).toBe(0);
      expect(snapshot.taskQueue.runningCount).toBe(0);
      expect(snapshot.taskQueue.failedCount).toBe(1);
    });

    it('updateTaskState 不存在的任务不应抛错', () => {
      expect(() => {
        manager.updateTaskState('nonexistent', { status: 'running' });
      }).not.toThrow();
    });
  });

  describe('配置缓存', () => {
    it('setConfig / getConfig 应能存取配置值', () => {
      manager.setConfig('maxRetries', 3);
      manager.setConfig('timeout', 5000);

      expect(manager.getConfig<number>('maxRetries')).toBe(3);
      expect(manager.getConfig<number>('timeout')).toBe(5000);
    });

    it('getConfig 不存在时应返回 undefined', () => {
      expect(manager.getConfig('missing')).toBeUndefined();
    });
  });

  describe('系统资源', () => {
    it('updateResources 应设置 memoryUsage 和 uptime', () => {
      manager.updateResources();
      const snapshot = manager.getSnapshot();

      expect(snapshot.resources.memoryUsage).toBeGreaterThan(0);
      expect(snapshot.resources.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getSnapshot', () => {
    it('应返回完整系统状态', () => {
      manager.updateChannelState('discord', { status: 'connected' });
      manager.updateAgentState('agent-1', { status: 'idle' });
      manager.addTask(makeTask({ taskId: 't1' }));
      manager.setConfig('key', 'value');

      const snapshot = manager.getSnapshot();

      expect(snapshot.version).toBe('1.0.0');
      expect(snapshot.startedAt).toBeGreaterThan(0);
      expect(snapshot.channels.get('discord')).toBeDefined();
      expect(snapshot.agents.get('agent-1')).toBeDefined();
      expect(snapshot.taskQueue.tasks).toHaveLength(1);
      expect(snapshot.configCache.get('key')).toBe('value');
      expect(snapshot.resources.memoryUsage).toBeGreaterThan(0);
    });
  });
});
