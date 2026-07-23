/**
 * Hooks — 钩子类型定义
 *
 * @module @myopenclaw/server/hooks
 */

import type { Message, Session, Task } from '../core/types/index.js';

/** 钩子事件类型 */
export type HookEvent =
  | 'message.pre'
  | 'message.post'
  | 'session.create'
  | 'session.close'
  | 'task.start'
  | 'task.complete'
  | 'task.fail'
  | 'tool.pre'
  | 'tool.post'
  | 'llm.pre'
  | 'llm.post';

/** 钩子上下文 */
export interface HookContext<TEvent extends HookEvent = HookEvent> {
  event: TEvent;
  data: HookEventDataMap[TEvent];
  abort: (reason?: string) => never;
  mutate: (newData: Partial<HookEventDataMap[TEvent]>) => void;
  log: (level: string, msg: string, meta?: Record<string, unknown>) => void;
}

/** 事件数据类型映射 */
export interface HookEventDataMap {
  'message.pre': { message: Message };
  'message.post': { message: Message; response: Message };
  'session.create': { session: Session };
  'session.close': { session: Session; reason?: string };
  'task.start': { task: Task };
  'task.complete': { task: Task; result: string };
  'task.fail': { task: Task; error: string };
  'tool.pre': { toolName: string; args: Record<string, unknown> };
  'tool.post': { toolName: string; args: Record<string, unknown>; result: unknown; durationMs: number };
  'llm.pre': { prompt: string; model: string };
  'llm.post': { prompt: string; response: string; model: string; tokensIn: number; tokensOut: number; durationMs: number };
}

/** 钩子函数签名 */
export type HookHandler<TEvent extends HookEvent = HookEvent> = (
  ctx: HookContext<TEvent>,
) => void | Promise<void>;

/** 钩子注册项 */
export interface HookRegistration<TEvent extends HookEvent = HookEvent> {
  name: string;
  event: TEvent;
  handler: HookHandler<TEvent>;
  priority?: number;
  enabled?: boolean;
}
