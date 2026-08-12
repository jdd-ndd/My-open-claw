/**
 * Planner - 任务规划引擎
 *
 * 基于 CoT（Chain of Thought）思维链将自然语言需求拆解为有序子任务，
 * 并对 LLM 输出动作做安全校验。
 *
 * @module @myopenclaw/server/agents
 */

import { createLogger } from '../core/utils/logger.js';
import {
  DEFAULT_BLOCKED_TOOLS,
  DEFAULT_DANGEROUS_PATTERNS as SECURITY_DANGEROUS_PATTERNS,
} from '../tools/security/index.js';

const log = createLogger('agent:planner');

export interface PlannerSubTask {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  dependsOn: string[];
  description: string;
  risk: 'low' | 'medium' | 'high';
  requiresConfirmation?: boolean;
}

export interface SecurityCheckResult {
  passed: boolean;
  reason?: string;
  failedField?: string;
  ruleId?: string;
}

export interface ExecutionPlan {
  groups: ExecutionGroup[];
}

export interface ExecutionGroup {
  tasks: PlannerSubTask[];
  parallel: boolean;
}

export interface ParsedCoT {
  thought?: string;
  action?: string;
  finalAnswer?: string;
  actionSteps: ActionStep[];
}

export interface ActionStep {
  tool: string;
  args: Record<string, unknown>;
  argsRaw: string;
  step: number;
  description?: string;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  risk: 'low' | 'medium' | 'high';
  builtin: boolean;
}

export interface PlannerContext {
  sessionId: string;
  userMessage?: string;
  availableTools: ToolDescriptor[];
  permissions: UserPermissions;
  allowedPaths: string[];
}

export interface UserPermissions {
  allowedCategories: string[];
  maxAutoRisk: 'low' | 'medium' | 'high';
  requireConfirmationForAll?: boolean;
}

const DEFAULT_DANGEROUS_TOOLS = DEFAULT_BLOCKED_TOOLS;
const DEFAULT_DANGEROUS_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'rm_rf_root', pattern: /rm\s+-rf\s+\// },
  { id: 'drop_table', pattern: /DROP\s+TABLE/i },
  { id: 'shutdown', pattern: /shutdown\s+-h\s+now/i },
  { id: 'sudo', pattern: /^sudo\s/ },
  { id: 'format', pattern: /mkfs\.|format\s+\w:/i },
  { id: 'dd_write', pattern: /dd\s+if=/i },
  ...SECURITY_DANGEROUS_PATTERNS
    .filter((p) => !['rm_rf_root', 'drop_table', 'shutdown', 'sudo', 'format', 'dd_write'].includes(p.category))
    .map((p) => ({ id: p.category, pattern: p.pattern })),
];

export class Planner {
  private dangerousTools: string[];
  private dangerousPatterns: Array<{ id: string; pattern: RegExp }>;
  private _allowedPaths: string[];
  private stepCounter = 0;

  constructor(options: {
    dangerousTools?: string[];
    dangerousPatterns?: Array<{ id: string; pattern: RegExp }>;
    allowedPaths?: string[];
  } = {}) {
    this.dangerousTools = options.dangerousTools ?? DEFAULT_DANGEROUS_TOOLS;
    this.dangerousPatterns = options.dangerousPatterns ?? DEFAULT_DANGEROUS_PATTERNS;
    this._allowedPaths = options.allowedPaths ?? [];
  }

  get allowedPaths(): string[] {
    return this._allowedPaths;
  }

  async plan(llmOutput: string, context: PlannerContext): Promise<PlannerSubTask[]> {
    this.stepCounter = 0;
    const timeDirect = this.planTimeQuestion(llmOutput, context);
    if (timeDirect) return timeDirect;

    const parsed = this.parseCoT(llmOutput);
    if (parsed.actionSteps.length === 0 && parsed.finalAnswer) {
      log.info('LLM output is pure text response, no tool calls required');
      return [];
    }

    const tasks: PlannerSubTask[] = [];
    let lastTaskId: string | null = null;

    for (const step of parsed.actionSteps) {
      const taskId = this.nextStepId();
      const toolDesc = context.availableTools.find((t) => t.name === step.tool);
      const task: PlannerSubTask = {
        id: taskId,
        tool: step.tool,
        params: step.args,
        dependsOn: lastTaskId ? [lastTaskId] : [],
        description: step.description ?? `Call ${step.tool} with ${this.shortenArgs(step.args)}`,
        risk: toolDesc?.risk ?? this.estimateRisk(step.tool),
        requiresConfirmation: this.shouldRequireConfirmation(step.tool, toolDesc?.risk, context.permissions),
      };

      const validation = this.validate(task);
      if (!validation.passed) {
        log.warn({ taskId, reason: validation.reason, ruleId: validation.ruleId }, 'subtask validation failed, skipped');
        if (task.risk === 'high') break;
        continue;
      }

      tasks.push(task);
      lastTaskId = taskId;
    }

    return tasks;
  }

  private planTimeQuestion(llmOutput: string, context: PlannerContext): PlannerSubTask[] | null {
    const text = `${context.userMessage ?? ''}\n${llmOutput}`.toLowerCase();
    if (!/(现在几点|几点了|当前时间|现在时间|现在几时|time\s*now|what time is it|current time|当前日期|今天几号|几号了)/i.test(text)) {
      return null;
    }
    if (!context.availableTools.some((t) => t.name === 'system/time')) {
      return null;
    }
    return [{
      id: this.nextStepId(),
      tool: 'system/time',
      params: {},
      dependsOn: [],
      description: '获取当前服务器时间',
      risk: 'low',
      requiresConfirmation: false,
    }];
  }

  isActionSafe(toolName: string): boolean {
    if (this.dangerousTools.includes(toolName)) {
      log.warn({ toolName }, 'high-risk tool blocked');
      return false;
    }
    return true;
  }

  validate(task: PlannerSubTask): SecurityCheckResult {
    if (this.dangerousTools.includes(task.tool)) {
      return { passed: false, reason: `tool ${task.tool} is blocked`, ruleId: 'TOOL_BLACKLIST' };
    }

    if (task.tool.startsWith('exec/')) {
      const cmd = String(task.params.command ?? task.params.cmd ?? '');
      for (const { id, pattern } of this.dangerousPatterns) {
        if (pattern.test(cmd)) {
          return { passed: false, reason: `blocked command pattern ${id}: ${cmd}`, ruleId: id };
        }
      }
    }

    if (this._allowedPaths.length > 0 && task.tool.startsWith('fs/')) {
      const path = String(task.params.path ?? '');
      if (!this.isPathAllowed(path)) {
        return {
          passed: false,
          reason: `path ${path} is outside allowed paths`,
          ruleId: 'PATH_WHITELIST',
        };
      }
    }

    return { passed: true };
  }

  schedule(tasks: PlannerSubTask[]): ExecutionPlan {
    if (tasks.length === 0) return { groups: [] };

    const groups: ExecutionGroup[] = [];
    const completed = new Set<string>();
    const remaining = [...tasks];

    while (remaining.length > 0) {
      const ready: PlannerSubTask[] = [];
      const blocked: PlannerSubTask[] = [];

      for (const task of remaining) {
        const depsSatisfied = task.dependsOn.length === 0 || task.dependsOn.every((dep) => completed.has(dep));
        if (depsSatisfied) ready.push(task); else blocked.push(task);
      }

      if (ready.length === 0 && blocked.length > 0) {
        const next = blocked.shift()!;
        groups.push({ tasks: [next], parallel: false });
        completed.add(next.id);
      } else {
        ready.forEach((t) => completed.add(t.id));
        if (ready.length > 0) groups.push({ tasks: ready, parallel: ready.length > 1 });
      }

      for (let i = remaining.length - 1; i >= 0; i--) {
        if (completed.has(remaining[i].id)) remaining.splice(i, 1);
      }
    }

    return { groups };
  }

  parseCoT(llmOutput: string): ParsedCoT {
    const thought = matchTag(llmOutput, 'thought');
    const finalAnswer = matchTag(llmOutput, 'final_answer');
    const actionSteps = this.extractActionSteps(llmOutput);
    const action = actionSteps.length > 0 ? `${actionSteps[0].tool}: ${actionSteps[0].argsRaw}` : undefined;
    return { thought, action, finalAnswer, actionSteps };
  }

  static buildToolDescriptors(tools: Array<{
    name: string;
    description: string;
    category: string;
    inputSchema: Record<string, unknown>;
  }>): ToolDescriptor[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      risk: Planner.estimateToolRisk(t.name),
      builtin: true,
    }));
  }

  private static estimateToolRisk(name: string, _description?: string): 'low' | 'medium' | 'high' {
    if (name === 'exec/root' || name === 'fs/rm_rf' || name.startsWith('fs/delete')) return 'high';
    if (name.startsWith('exec/') || name.startsWith('fs/write') || name.startsWith('http/')) return 'medium';
    if (name.startsWith('fs/read') || name.startsWith('browser/') || name.startsWith('memory_search/')) return 'low';
    return 'medium';
  }

  private isPathAllowed(path: string): boolean {
    if (!path) return false;
    const normalized = path.replace(/\\/g, '/');
    return this._allowedPaths.some((allowed) => {
      const normAllowed = allowed.replace(/\\/g, '/').replace(/\/$/, '');
      return normalized === normAllowed || normalized.startsWith(`${normAllowed}/`);
    });
  }

  private nextStepId(): string {
    return `step-${++this.stepCounter}`;
  }

  private estimateRisk(tool: string): 'low' | 'medium' | 'high' {
    return Planner.estimateToolRisk(tool);
  }

  private shouldRequireConfirmation(
    tool: string,
    risk: 'low' | 'medium' | 'high' | undefined,
    permissions: UserPermissions,
  ): boolean {
    if (permissions.requireConfirmationForAll) return true;
    const effectiveRisk = risk ?? this.estimateRisk(tool);
    const riskOrder = { low: 0, medium: 1, high: 2 } as const;
    return riskOrder[effectiveRisk] > riskOrder[permissions.maxAutoRisk];
  }

  private extractActionSteps(llmOutput: string): ActionStep[] {
    const steps: ActionStep[] = [];
    let stepNum = 0;
    const selfCloseRegex = /<action\s+([^>]*?)\/\s*>/gi;
    let match: RegExpExecArray | null;

    while ((match = selfCloseRegex.exec(llmOutput)) !== null) {
      const attrs = match[1];
      const nameMatch = attrs.match(/name\s*=\s*"([^"]+)"/);
      const descMatch = attrs.match(/description\s*=\s*"([^"]+)"/);
      if (!nameMatch) continue;
      const argsRaw = extractArgsValue(attrs);
      const parsedArgs = safeParseJson(argsRaw);
      if (parsedArgs === null) {
        log.warn({ tool: nameMatch[1], argsRaw: argsRaw.slice(0, 100) }, 'action args JSON parse failed');
        continue;
      }
      steps.push({ tool: nameMatch[1], args: parsedArgs, argsRaw, step: ++stepNum, description: descMatch?.[1] });
    }

    const pairedRegex = /<action\s+([^>]+)>([\s\S]*?)<\/action>/gi;
    while ((match = pairedRegex.exec(llmOutput)) !== null) {
      const attrs = match[1];
      const body = match[2].trim();
      const nameMatch = attrs.match(/name\s*=\s*"([^"]+)"/);
      const descMatch = attrs.match(/description\s*=\s*"([^"]+)"/);
      if (!nameMatch) continue;
      const argsRaw = extractArgsValue(attrs);
      const parsedArgs = safeParseJson(argsRaw);
      if (parsedArgs === null) {
        log.warn({ tool: nameMatch[1], argsRaw: argsRaw.slice(0, 100) }, 'action args JSON parse failed');
        continue;
      }
      steps.push({ tool: nameMatch[1], args: parsedArgs, argsRaw, step: ++stepNum, description: descMatch?.[1] ?? (body || undefined) });
    }

    return steps;
  }

  private shortenArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args).slice(0, 2);
    return entries.map(([k, v]) => `${k}=${String(v).slice(0, 30)}`).join(', ');
  }
}

function matchTag(input: string, tag: string): string | undefined {
  const selfCloseRegex = new RegExp(`<${tag}([^>]*?)/\\s*>`, 'i');
  const selfCloseMatch = input.match(selfCloseRegex);
  if (selfCloseMatch) return selfCloseMatch[1].trim();
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = input.match(regex);
  return match?.[1]?.trim();
}

function extractArgsValue(attrs: string): string {
  const balancedArgs = extractBalancedJsonArgs(attrs);
  if (balancedArgs) return balancedArgs;
  const normalizedAttrs = attrs.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const singleQuoteMatch = normalizedAttrs.match(/args\s*=\s*'((?:[^'\\]|\\.)*)'/);
  if (singleQuoteMatch) return singleQuoteMatch[1];
  const doubleQuoteMatch = normalizedAttrs.match(/args\s*=\s*"((?:[^"\\]|\\.)*)"/);
  if (doubleQuoteMatch) return doubleQuoteMatch[1];
  const braceMatch = normalizedAttrs.match(/args\s*=\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/);
  if (braceMatch) return braceMatch[1];
  return '{}';
}

function extractBalancedJsonArgs(attrs: string): string | null {
  const argsMatch = attrs.match(/args\s*=\s*/);
  if (!argsMatch || argsMatch.index === undefined) return null;
  const searchStart = argsMatch.index + argsMatch[0].length;
  const jsonStart = attrs.indexOf('{', searchStart);
  if (jsonStart === -1) return null;

  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = jsonStart; i < attrs.length; i += 1) {
    const ch = attrs[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return attrs.slice(jsonStart, i + 1);
    }
  }

  return null;
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  if (!raw || raw.trim() === '' || raw.trim() === '{}') return {};
  const normalized = raw.trim();
  try {
    const parsed = JSON.parse(normalized);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return null;
  }
}

