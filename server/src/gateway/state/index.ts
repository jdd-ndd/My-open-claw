/**
 * StateManager —— 全局状态管理器
 *
 * 基于 EventEmitter 管理 Gateway 所有运行态数据，
 * 包括渠道连接、Agent 状态、任务队列、配置缓存和系统资源。
 *
 * @module @myopenclaw/server/gateway
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '../../core/utils/logger.js';
import type {
  ChannelState,
  AgentState,
  TaskState,
  SystemState,
} from './types.js';

const log = createLogger('gateway:state');

export class StateManager extends EventEmitter {
  /** 系统全局状态（私有，仅通过方法访问） */
  private state!: SystemState;

  /**
   * 创建状态管理器实例
   * @param version - 网关版本号
   */
  constructor(version: string) {
    super();
    this.state = this.createInitialState(version);
  }

  /**
   * 创建初始状态（纯数据工厂，与 mutable 操作分离）
   */
  private createInitialState(version: string): SystemState {
    return {
      startedAt: Date.now(),
      version,
      channels: new Map(),
      agents: new Map(),
      taskQueue: {
        pendingCount: 0,
        runningCount: 0,
        completedCount: 0,
        failedCount: 0,
        tasks: [],
      },
      configCache: new Map(),
      resources: {
        memoryUsage: 0,
        cpuUsage: 0,
        uptime: 0,
      },
    };
  }

  // ==================== 渠道状态管理 ====================

  updateChannelState(channelId: string, update: Partial<ChannelState>): void {
    const existing = this.state.channels.get(channelId);
    if (existing) {
      Object.assign(existing, update);
    } else {
      const defaultState: ChannelState = {
        channelId,
        status: 'disconnected',
        lastConnectedAt: 0,
        reconnectAttempts: 0,
        stats: {
          messagesReceived: 0,
          messagesSent: 0,
        },
      };
      this.state.channels.set(channelId, Object.assign(defaultState, update));
    }
    log.debug({ channelId, update }, '渠道状态已更新');
    this.emit('channel:stateChanged', channelId, this.state.channels.get(channelId));
  }

  getChannelState(channelId: string): ChannelState | undefined {
    return this.state.channels.get(channelId);
  }

  getAllChannelStates(): ChannelState[] {
    return Array.from(this.state.channels.values());
  }

  // ==================== Agent 状态管理 ====================

  updateAgentState(agentId: string, update: Partial<AgentState>): void {
    const existing = this.state.agents.get(agentId);
    if (existing) {
      Object.assign(existing, update);
    } else {
      const defaultState: AgentState = {
        agentId,
        status: 'idle',
        lastActiveAt: Date.now(),
        stats: {
          totalInvocations: 0,
          totalTokensUsed: 0,
          averageResponseTime: 0,
        },
      };
      this.state.agents.set(agentId, Object.assign(defaultState, update));
    }
    log.debug({ agentId, update }, 'Agent 状态已更新');
    this.emit('agent:stateChanged', agentId, this.state.agents.get(agentId));
  }

  getAgentState(agentId: string): AgentState | undefined {
    return this.state.agents.get(agentId);
  }

  getIdleAgents(): AgentState[] {
    return Array.from(this.state.agents.values()).filter(
      (agent) => agent.status === 'idle',
    );
  }

  // ==================== 任务队列管理 ====================

  addTask(task: TaskState): void {
    this.state.taskQueue.tasks.push(task);
    this.state.taskQueue.pendingCount++;
    log.debug({ taskId: task.taskId }, '任务已加入队列');
    this.emit('task:added', task);
  }

  updateTaskState(taskId: string, update: Partial<TaskState>): void {
    const task = this.state.taskQueue.tasks.find((t) => t.taskId === taskId);
    if (!task) {
      log.warn({ taskId }, '未找到要更新的任务');
      return;
    }

    const oldStatus = task.status;
    if (update.status && update.status !== oldStatus) {
      this.adjustTaskCounter(oldStatus, -1);
      this.adjustTaskCounter(update.status, 1);
    }

    Object.assign(task, update);
    log.debug({ taskId, update }, '任务状态已更新');
    this.emit('task:stateChanged', taskId, task);
  }

  private adjustTaskCounter(status: TaskState['status'], delta: number): void {
    switch (status) {
      case 'pending':   this.state.taskQueue.pendingCount += delta;   break;
      case 'running':   this.state.taskQueue.runningCount += delta;   break;
      case 'completed': this.state.taskQueue.completedCount += delta; break;
      case 'failed':    this.state.taskQueue.failedCount += delta;    break;
    }
  }

  // ==================== 配置缓存 ====================

  setConfig(key: string, value: unknown): void {
    this.state.configCache.set(key, value);
  }

  getConfig<T>(key: string): T | undefined {
    return this.state.configCache.get(key) as T | undefined;
  }

  // ==================== 系统资源 ====================

  updateResources(): void {
    this.state.resources.memoryUsage = process.memoryUsage().rss / 1024 / 1024;
    this.state.resources.uptime = (Date.now() - this.state.startedAt) / 1000;
  }

  // ==================== 快照 ====================

  /**
   * 获取系统完整状态快照
   *
   * 返回深拷贝以保证内部状态不被外部调用者意外修改。
   * Map 类型的 channels / agents / configCache 也会被正确复制。
   */
  getSnapshot(): SystemState {
    this.updateResources();

    // 深拷贝所有 Map 和数组
    return {
      ...this.state,
      channels: new Map(this.state.channels),
      agents: new Map(this.state.agents),
      configCache: new Map(this.state.configCache),
      taskQueue: {
        ...this.state.taskQueue,
        tasks: this.state.taskQueue.tasks.map((t) => ({ ...t })),
      },
    };
  }
}
