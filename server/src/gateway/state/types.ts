/**
 * State 模块类型定义
 *
 * @module @myopenclaw/server/gateway
 */

/** 渠道连接状态 */
export interface ChannelState {
  /** 渠道唯一标识 */
  channelId: string;
  /** 连接状态 */
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  /** 最后连接时间戳（毫秒） */
  lastConnectedAt: number;
  /** 最后断开时间戳（毫秒） */
  lastDisconnectedAt?: number;
  /** 错误信息 */
  errorMessage?: string;
  /** 重连尝试次数 */
  reconnectAttempts: number;
  /** 统计信息 */
  stats: {
    /** 接收消息总数 */
    messagesReceived: number;
    /** 发送消息总数 */
    messagesSent: number;
    /** 最后一条消息时间戳（毫秒） */
    lastMessageAt?: number;
  };
}

/** Agent 运行状态 */
export interface AgentState {
  /** Agent 唯一标识 */
  agentId: string;
  /** 运行状态 */
  status: 'idle' | 'busy' | 'error' | 'stopped';
  /** 当前正在执行的任务 ID */
  currentTaskId?: string;
  /** 当前会话 ID */
  currentSessionId?: string;
  /** 最后活跃时间戳（毫秒） */
  lastActiveAt: number;
  /** 错误信息 */
  errorMessage?: string;
  /** 统计信息 */
  stats: {
    /** 总调用次数 */
    totalInvocations: number;
    /** 总消耗 Token 数 */
    totalTokensUsed: number;
    /** 平均响应时间（毫秒） */
    averageResponseTime: number;
    /** 最后调用时间戳（毫秒） */
    lastInvocationAt?: number;
  };
}

/** 任务状态 */
export interface TaskState {
  /** 任务唯一标识 */
  taskId: string;
  /** 任务名称 */
  name: string;
  /** 任务类型 */
  type: 'cron' | 'delay';
  /** 任务执行状态 */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** 关联的 Agent ID */
  agentId: string;
  /** 下次运行时间戳（毫秒） */
  nextRunAt?: number;
  /** 上次运行时间戳（毫秒） */
  lastRunAt?: number;
  /** 执行耗时（毫秒） */
  duration?: number;
}

/** 任务队列状态 */
export interface TaskQueueState {
  /** 等待中的任务数 */
  pendingCount: number;
  /** 运行中的任务数 */
  runningCount: number;
  /** 已完成的任务数 */
  completedCount: number;
  /** 失败的任务数 */
  failedCount: number;
  /** 任务列表 */
  tasks: TaskState[];
}

/** 系统全局状态 */
export interface SystemState {
  /** 网关启动时间戳（毫秒） */
  startedAt: number;
  /** 网关版本号 */
  version: string;
  /** 渠道状态映射 */
  channels: Map<string, ChannelState>;
  /** Agent 状态映射 */
  agents: Map<string, AgentState>;
  /** 任务队列状态 */
  taskQueue: TaskQueueState;
  /** 配置缓存 */
  configCache: Map<string, unknown>;
  /** 系统资源信息 */
  resources: {
    /** 内存使用量（MB） */
    memoryUsage: number;
    /** CPU 使用率（百分比） */
    cpuUsage: number;
    /** 运行时长（秒） */
    uptime: number;
  };
}
