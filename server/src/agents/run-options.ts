/**
 * Agent 运行期选项 (workMode / intensity / model)
 *
 * 文档参考: docs/05-Agent运行时模块.md + P1.3 client/server 协议扩展
 *
 * 设计要点:
 * - 客户端 (TUI) 通过 chat.send payload 的 workMode / intensity / model 字段传入
 * - 服务端在 AgentRuntimeAdapter 入口从 message.metadata 读出, 封装为 AgentRunOptions
 * - Orchestrator 在 phaseThink / phaseReflect 阶段读取, 用于:
 *   1) 注入 workMode 提示词 (plan 模式禁用工具, build 模式正常)
 *   2) 把 intensity 映射成 LLM 调用参数 (temperature / maxTokens / DeepSeek reasoning_effort)
 *   3) model 字段透传到 LLMChatInput.options.model, 由 adapter 决定是否覆盖
 *
 * @module @myopenclaw/server/agents
 */

/** 工作模式: 跟 client 端 WorkMode Literal 保持一致 */
export type WorkMode = 'plan' | 'build';

/** 推理强度: 4 档, 跟 client 端 Intensity Literal 一致 */
export type Intensity = 'low' | 'medium' | 'high' | 'max';

/** 运行时选项聚合 */
export interface AgentRunOptions {
  workMode?: WorkMode;
  intensity?: Intensity;
  /** model id (同 provider 下换档, e.g. deepseek-v4-pro -> deepseek-v4-flash) */
  model?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// 类型守卫
// ─────────────────────────────────────────────────────────────────────────

export function isWorkMode(s: unknown): s is WorkMode {
  return s === 'plan' || s === 'build';
}

export function isIntensity(s: unknown): s is Intensity {
  return s === 'low' || s === 'medium' || s === 'high' || s === 'max';
}

/**
 * 从 Message.metadata 提取 run options
 *
 * 容忍类型不匹配: 任何字段缺失/类型错误都返回 undefined, 不阻塞主流程
 */
export function extractRunOptions(metadata: Record<string, unknown> | undefined): AgentRunOptions {
  if (!metadata || typeof metadata !== 'object') return {};
  return {
    workMode: isWorkMode(metadata.workMode) ? metadata.workMode : undefined,
    intensity: isIntensity(metadata.intensity) ? metadata.intensity : undefined,
    model: typeof metadata.model === 'string' ? metadata.model : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// intensity → LLM 调参
// ─────────────────────────────────────────────────────────────────────────

/**
 * intensity → LLMChatInput.options 片段
 *
 * 映射规则 (跟 OpenCode 思路一致, 但具体数值我们自定):
 * - low:    温度 0.3, max 2k,  reasoning effort low    (省 token, 适合简单问答)
 * - medium: 温度 0.5, max 4k,  reasoning effort medium (默认)
 * - high:   温度 0.7, max 8k,  reasoning effort high   (较强推理)
 * - max:    温度 0.7, max 16k, reasoning effort max    (全力, Agent 类复杂任务)
 */
export function intensityToLLMOptions(intensity: Intensity | undefined): {
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'max';
} {
  if (!intensity) return {};
  switch (intensity) {
    case 'low':
      return { temperature: 0.3, maxTokens: 2048, reasoningEffort: 'low' };
    case 'medium':
      return { temperature: 0.5, maxTokens: 4096, reasoningEffort: 'medium' };
    case 'high':
      return { temperature: 0.7, maxTokens: 8192, reasoningEffort: 'high' };
    case 'max':
      return { temperature: 0.7, maxTokens: 16384, reasoningEffort: 'max' };
    default:
      return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────
// workMode → system prompt 追加段
// ─────────────────────────────────────────────────────────────────────────

/**
 * 根据 workMode 追加到 system prompt 的指令片段
 *
 * 重要: 这些指令与基础 system prompt 用两个独立段落, 方便日后单独维护和测试
 */
export function workModeSystemPromptAddon(workMode: WorkMode | undefined): string {
  if (!workMode) return '';
  if (workMode === 'plan') {
    return [
      '',
      '## 当前模式: Plan (规划模式)',
      '- 只读分析 + 思考, **禁止调用任何工具** (即使你"觉得"应该读个文件)',
      '- 输出结构化计划: 目标 / 步骤 / 风险 / 验证方式',
      '- 如用户后续要求执行, 在 <final_answer> 末尾明确标注 "需要切回 Build 模式才能执行"',
      '- **不要** 解析或响应工具调用块, 把它当成不存在',
    ].join('\n');
  }
  // build
  return [
    '',
    '## 当前模式: Build (构建模式)',
    '- 自由使用工具完成用户请求',
    '- 完成后用 <final_answer> 给出简洁结果',
  ].join('\n');
}
