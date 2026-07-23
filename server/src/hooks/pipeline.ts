/**
 * Hooks — 管线引擎
 *
 * 按 priority 顺序执行钩子，支持错误隔离与中止机制。
 *
 * @module @myopenclaw/server/hooks
 */

import type { HookRegistration, HookEvent, HookContext, HookEventDataMap } from './types.js';

class AbortError extends Error {
  constructor(reason: string) {
    super(`Hook pipeline aborted: ${reason}`);
    this.name = 'AbortError';
  }
}

/** 内部存储项 */
interface InternalHookItem {
  name: string;
  event: HookEvent;
  handler: (ctx: HookContext<HookEvent>) => void | Promise<void>;
  priority: number;
  enabled: boolean;
}

export class HookPipeline {
  private registrations = new Map<string, InternalHookItem[]>();

  /** 注册钩子 */
  register<TEvent extends HookEvent>(reg: HookRegistration<TEvent>): void {
    const list = this.registrations.get(reg.event) ?? [];
    list.push({
      name: reg.name,
      event: reg.event,
      handler: reg.handler as unknown as (ctx: HookContext<HookEvent>) => void | Promise<void>,
      priority: reg.priority ?? 100,
      enabled: reg.enabled ?? true,
    });
    list.sort((a, b) => a.priority - b.priority);
    this.registrations.set(reg.event, list);
  }

  /** 注销钩子 */
  unregister(name: string): void {
    for (const [event, list] of this.registrations) {
      const idx = list.findIndex((r) => r.name === name);
      if (idx !== -1) {
        list.splice(idx, 1);
        if (list.length === 0) this.registrations.delete(event);
        else this.registrations.set(event, list);
        return;
      }
    }
  }

  /** 执行指定事件的所有钩子 */
  async execute<TEvent extends HookEvent>(
    event: TEvent,
    data: HookEventDataMap[TEvent],
  ): Promise<void> {
    const hooks = this.registrations.get(event);
    if (!hooks?.length) return;

    let mutableData = { ...data };

    for (const hook of hooks) {
      if (!hook.enabled) continue;

      const ctx = {
        event,
        data: mutableData,
        abort: (reason?: string) => {
          throw new AbortError(reason ?? 'Hook pipeline aborted');
        },
        mutate: (newData: Record<string, unknown>) => {
          // 使用展开运算符创建新对象，避免引用污染
          mutableData = { ...mutableData, ...newData };
        },
        log: (level, msg, meta) => {
          if (level === 'error') console.error(`[hook:${hook.name}] ${msg}`, meta ?? '');
          else if (level === 'warn') console.warn(`[hook:${hook.name}] ${msg}`, meta ?? '');
          else console.log(`[hook:${hook.name}] ${msg}`, meta ?? '');
        },
      } as HookContext<TEvent>;

      try {
        await (hook.handler as unknown as (ctx: HookContext<TEvent>) => void | Promise<void>)(ctx);
      } catch (err) {
        if (err instanceof AbortError) throw err;
        console.error(`[Hook ${hook.name}] Error:`, err);
      }
    }
  }
}
