/**
 * Agent 运行时相关类型定义
 *
 * Agent 状态机转换规则：
 * ```
 * idle →(收到消息)→ thinking →(需要工具)→ executing →(工具返回)→ thinking
 *                       ↓(直接回复)     ↓(异常)
 *                       idle           error
 * ```
 *
 * @module @myopenclaw/server/core/types
 */

/** Agent 状态枚举 */
export type AgentState = 'idle' | 'thinking' | 'executing' | 'error';
