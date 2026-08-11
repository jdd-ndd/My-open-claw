/**
 * Agents — Agent 模块聚合导出
 *
 * 导出 Lobster Orchestrator、Planner、ReActLoop 及所有相关类型。
 *
 * @module @myopenclaw/server/agents
 */

// ── Orchestrator ──
export { AgentOrchestrator } from './orchestrator.js';
export type {
  OrchestratorOptions,
  AgentRunInput,
  AgentRunResult,
  ExecutionStep,
} from './orchestrator.js';

// ── Planner ──
export { Planner } from './planner.js';
export type {
  PlannerSubTask,
  SecurityCheckResult,
  ExecutionPlan,
  ExecutionGroup,
  ParsedCoT,
  ActionStep,
  ToolDescriptor,
  PlannerContext,
  UserPermissions,
} from './planner.js';

// ── ReActLoop ──
export { ReActLoop } from './loop/index.js';
export type { LoopPhase, LoopStepEvent } from './loop/index.js';

// ── Mock 组件（@deprecated 详见 mock.ts 顶部）
//   生产环境请使用:
//   - ToolRegistry from '../../tools/registry.js'
//   - SkillRegistry from '../../skills/registry.js'
//   - 通过 AgentRuntimeAdapter.create() 自动注入
export {
  MockToolRegistry,
  MockSkillRegistry,
  MockVectorMemory,
  MockSessionMemory,
} from './mock.js';
export type { MockTool } from './mock.js';

// ── LLM 子模块 ──
export * from './llm/index.js';
