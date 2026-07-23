/**
 * Planner — 任务规划引擎
 *
 * 基于 CoT（Chain of Thought）思维链将自然语言需求拆解为有序子任务，
 * 并对 LLM 输出动作做安全校验。
 *
 * @module @myopenclaw/server/agents
 */

import { createLogger } from '../core/utils/logger.js';

const log = createLogger('agent:planner');

export class Planner {
  /**
   * 检查待执行动作的安全性
   *
   * @param toolName - 工具名称
   * @returns 是否允许执行
   */
  isActionSafe(toolName: string): boolean {
    const dangerousTools = ['exec/root', 'fs/rm_rf'];
    if (dangerousTools.includes(toolName)) {
      log.warn({ toolName }, '高危工具调用已拦截');
      return false;
    }
    return true;
  }
}
