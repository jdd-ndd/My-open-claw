/**
 * Hooks — 钩子注册中心（全局单例）
 *
 * @module @myopenclaw/server/hooks
 */

import { HookPipeline } from './pipeline.js';
import type { HookRegistration, HookEvent } from './types.js';

/** 全局单例 */
const globalPipeline = new HookPipeline();

/** 注册钩子 */
export function registerHook<TEvent extends HookEvent>(reg: HookRegistration<TEvent>): void {
  globalPipeline.register(reg);
}

/** 注销钩子 */
export function unregisterHook(name: string): void {
  globalPipeline.unregister(name);
}

/** 获取全局管线（供业务模块调用 execute） */
export function getPipeline(): HookPipeline {
  return globalPipeline;
}
