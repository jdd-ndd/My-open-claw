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
    this.state = {
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

  /**
   * 更新渠道连接状态
   * @param channelId - 渠道唯一标识
   * @param update - 要更新的部分字段
   */
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

  /**
   * 获取指定渠道的状态
   * @param channelId - 渠道唯一标识
   * @returns 渠道状态，不存在时返回 undefined
   */
  getChannelState(channelId: string): ChannelState | undefined {
    return this.state.channels.get(channelId);
  }

  /**
   * 获取所有渠道的状态列表
   * @returns 渠道状态数组
   */
  getAllChannelStates(): ChannelState[] {
    return Array.from(this.state.channels.values());
  }

  // ==================== Agent 状态管理 ====================

  /**
   * 更新 Agent 运行状态
   * @param agentId - Agent 唯一标识
   * @param update - 要更新的部分字段
   */
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

  /**
   * 获取指定 Agent 的状态
   * @param agentId - Agent 唯一标识
   * @returns Agent 状态，不存在时返回 undefined
   */
  getAgentState(agentId: string): AgentState | undefined {
    return this.state.agents.get(agentId);
  }

  /**
   * 获取所有空闲的 Agent
   * @returns 状态为 idle 的 Agent 列表
   */
  getIdleAgents(): AgentState[] {
    return Array.from(this.state.agents.values()).filter(
      (agent) => agent.status === 'idle',
    );
  }

  // ==================== 任务队列管理 ====================

  /**
   * 添加新任务到队列
   * @param task - 任务状态对象
   */
  addTask(task: TaskState): void {
    this.state.taskQueue.tasks.push(task);
    this.state.taskQueue.pendingCount++;
    log.debug({ taskId: task.taskId }, '任务已加入队列');
    this.emit('task:added', task);
  }

  /**
   * 更新任务状态，自动调整队列计数器
   * @param taskId - 任务唯一标识
   * @param update - 要更新的部分字段
   */
  updateTaskState(taskId: string, update: Partial<TaskState>): void {
    const task = this.state.taskQueue.tasks.find((t) => t.taskId === taskId);
    if (!task) {
      log.warn({ taskId }, '未找到要更新的任务');
      return;
    }

    // 状态变更时调整计数器
    const oldStatus = task.status;
    if (update.status && update.status !== oldStatus) {
      this.adjustTaskCounter(oldStatus, -1);
      this.adjustTaskCounter(update.status, 1);
    }

    Object.assign(task, update);
    log.debug({ taskId, update }, '任务状态已更新');
    this.emit('task:stateChanged', taskId, task);
  }

  /**
   * 调整任务队列计数器
   * @param status - 任务状态
   * @param delta - 增减量（+1 或 -1）
   */
  private adjustTaskCounter(
    status: TaskState['status'],
    delta: number,
  ): void {
    switch (status) {
      case 'pending':
        this.state.taskQueue.pendingCount += delta;
        break;
      case 'running':
        this.state.taskQueue.runningCount += delta;
        break;
      case 'completed':
        this.state.taskQueue.completedCount += delta;
        break;
      case 'failed':
        this.state.taskQueue.failedCount += delta;
        break;
    }
  }

  // ==================== 配置缓存 ====================

  /**
   * 存储配置项到缓存
   * @param key - 配置键
   * @param value - 配置值
   */
  setConfig(key: string, value: unknown): void {
    this.state.configCache.set(key, value);
  }

  /**
   * 从缓存获取配置项
   * @param key - 配置键
   * @returns 配置值，不存在时返回 undefined
   */
  getConfig<T>(key: string): T | undefined {
    return this.state.configCache.get(key) as T | undefined;
  }

  // ==================== 系统资源 ====================

  /**
   * 更新系统资源信息（内存、CPU、运行时长）
   */
  updateResources(): void {
    this.state.resources.memoryUsage =
      process.memoryUsage().rss / 1024 / 1024;
    this.state.resources.uptime =
      (Date.now() - this.state.startedAt) / 1000;
    // CPU 使用率保留为 0，如需精确采集可由外部进程指标注入
  }

  // ==================== 快照 ====================

  /**
   * 获取系统完整状态快照
   * @returns 当前系统状态（包含最新资源数据）
   */
  getSnapshot(): SystemState {
    this.updateResources();
    return this.state;
  }
}
