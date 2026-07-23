/**
 * 事件名常量
 *
 * @module @myopenclaw/server/core/constants
 */

export const EventType = {
  MESSAGE_RECEIVED: 'messageReceived',
  AGENT_THINKING: 'agentThinking',
  TOOL_EXECUTING: 'toolExecuting',
  TOOL_COMPLETED: 'toolCompleted',
  TASK_COMPLETED: 'taskCompleted',
  SESSION_CREATED: 'sessionCreated',
  SESSION_CLOSED: 'sessionClosed',
  ERROR: 'error',
} as const;

export type EventTypeName = (typeof EventType)[keyof typeof EventType];
