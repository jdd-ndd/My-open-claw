/**
 * Agent 运行时 Mock 组件
 *
 * ⚠️ 本文件已弃用(deprecated),仅保留:
 * - 单元测试桩(orchestrator / planner 的单测)
 * - 历史兼容性回退(若未通过 AgentRuntimeAdapter.create() 注入真实依赖)
 *
 * **生产环境请使用真实实现**:
 * - ToolRegistry: `server/src/tools/registry.ts`(13 个内置工具)
 * - SkillRegistry: `server/src/skills/registry.ts`(SKILL.md 扫描)
 * - VectorMemory / SessionMemory: 接入真实向量库 / DB
 *
 * 历史背景:
 * 早期(2026/05 前)真实工具/技能/记忆模块尚未完成,
 * Mock 作为占位让 Agent 运行时各阶段能跑通。
 * 2026/07 后真实模块已落地,`AgentRuntimeAdapter.create()`
 * 默认装载真实依赖,本文件仅作 fallback + 单测桩。
 *
 * @module @myopenclaw/server/agents
 * @deprecated 推荐使用 server/src/tools + server/src/skills
 */

import { createLogger } from '../core/utils/logger.js';
import type { InvokeContext, ToolContext, ToolResult } from '../core/types/index.js';
import type { Skill } from '../skills/types.js';

const log = createLogger('agent:mock');

// ═══════════════════════════════════════════════════════════════
// MockToolRegistry — 模拟工具注册中心
// ═══════════════════════════════════════════════════════════════

/** 模拟工具接口 */
export interface MockTool {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly inputSchema: Record<string, unknown>;
}

/** 预置工具行为映射 */
type ToolBehavior = (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;

/**
 * 模拟工具注册中心
 *
 * 提供与真实 ToolRegistry 相同的接口规范，
 * 内置常见工具的模拟返回结果。
 */
export class MockToolRegistry {
  private tools = new Map<string, MockTool>();
  private behaviors = new Map<string, ToolBehavior>();

  constructor(tools?: MockTool[]) {
    // 注册预置基础工具
    // 注意:tool name 必须匹配 ^[a-zA-Z0-9_-]+$,否则 DeepSeek API 会 400。
    // 所以用 '-' 替代 '/' 作为分隔符
    const defaultTools: MockTool[] = tools ?? [
      {
        name: 'fs-read_file',
        description: '读取本地文件内容',
        category: 'fs',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: '文件路径' } },
          required: ['path'],
        },
      },
      {
        name: 'fs-write_file',
        description: '写入内容到本地文件',
        category: 'fs',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            content: { type: 'string', description: '文件内容' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'fs-list_dir',
        description: '列出目录内容',
        category: 'fs',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: '目录路径' } },
          required: ['path'],
        },
      },
      {
        name: 'exec-shell',
        description: '执行 Shell 命令',
        category: 'exec',
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'string', description: 'Shell 命令' } },
          required: ['command'],
        },
      },
      {
        name: 'http-get',
        description: '发起 HTTP GET 请求',
        category: 'http',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string', description: '请求 URL' } },
          required: ['url'],
        },
      },
      {
        name: 'http-post',
        description: '发起 HTTP POST 请求',
        category: 'http',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '请求 URL' },
            body: { type: 'object', description: '请求体' },
          },
          required: ['url'],
        },
      },
      {
        name: 'browser-navigate',
        description: '浏览器导航到指定 URL',
        category: 'browser',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string', description: '目标 URL' } },
          required: ['url'],
        },
      },
      {
        name: 'memory_search-search',
        description: '在长期记忆中搜索相关内容',
        category: 'memory_search',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索查询' },
            topK: { type: 'number', description: '返回结果数' },
          },
          required: ['query'],
        },
      },
    ];

    for (const tool of defaultTools) {
      this.tools.set(tool.name, tool);
      // 注册默认模拟行为
      this.behaviors.set(tool.name, this.createDefaultBehavior(tool.name));
    }
  }

  /** 注册自定义工具 */
  register(tool: MockTool): void {
    this.tools.set(tool.name, tool);
    if (!this.behaviors.has(tool.name)) {
      this.behaviors.set(tool.name, this.createDefaultBehavior(tool.name));
    }
    log.debug({ tool: tool.name }, '[Mock] 工具已注册');
  }

  /** 注册工具的自定义行为 */
  registerBehavior(toolName: string, behavior: ToolBehavior): void {
    this.behaviors.set(toolName, behavior);
    log.debug({ toolName }, '[Mock] 工具行为已注册');
  }

  /** 执行工具 */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return {
        success: false,
        status: 'error',
        error: `工具 ${toolName} 未注册`,
      };
    }

    const behavior = this.behaviors.get(toolName);
    if (!behavior) {
      return {
        success: false,
        status: 'error',
        error: `工具 ${toolName} 无对应行为`,
      };
    }

    try {
      const result = await behavior(args, ctx);
      return {
        success: true,
        status: 'success',
        result,
        metadata: { durationMs: 0, sideEffects: [] },
      };
    } catch (err) {
      return {
        success: false,
        status: 'error',
        error: (err as Error).message,
      };
    }
  }

  /**
   * 执行工具（新接口，与真实 ToolRegistry.invoke 对齐）
   *
   * 接受完整的 InvokeContext（包含 permissions 和 allowedPaths），
   * 内部转调 execute 方法，保持 Mock 模式下的简化行为。
   *
   * @param toolName 工具名
   * @param args 参数
   * @param context 完整调用上下文（InvokeContext 类型）
   * @returns 工具执行结果
   */
  async invoke(
    toolName: string,
    args: Record<string, unknown>,
    context: InvokeContext,
  ): Promise<ToolResult> {
    // 将 InvokeContext 转为 ToolContext（兼容旧接口）
    const ctx: ToolContext = {
      sessionId: context.sessionId,
      userId: context.userId,
      channelId: context.channelId,
      config: context.config ?? {},
    };
    // 调用现有的 execute 方法（Mock 模式不做权限校验，仅记录日志）
    if (context.permissions) {
      log.debug(
        { toolName, allowedCategories: context.permissions.allowedCategories },
        'Mock 模式下权限信息已收到但不做实际校验',
      );
    }
    return this.execute(toolName, args, ctx);
  }

  /** 获取全部已注册工具列表 */
  listAll(): MockTool[] {
    return Array.from(this.tools.values());
  }

  /** 卸载工具 */
  unregister(toolName: string): void {
    this.tools.delete(toolName);
    this.behaviors.delete(toolName);
  }

  /** 为工具创建默认模拟行为 */
  private createDefaultBehavior(toolName: string): ToolBehavior {
    // 根据工具分类返回合理的模拟数据
    if (toolName.startsWith('fs/read')) {
      return async (args) =>
        `[模拟文件内容] 文件 ${args.path} 的内容为：这是模拟的文件数据。（Mock Mode）`;
    }
    if (toolName.startsWith('fs/write')) {
      return async (args) => `[模拟写入] 已成功写入文件 ${args.path}，大小 1024 字节。（Mock Mode）`;
    }
    if (toolName.startsWith('fs/list')) {
      return async (args) => `[模拟目录] ${args.path} 内容：["file1.txt", "file2.md", "subdir/"]（Mock Mode）`;
    }
    if (toolName.startsWith('exec/')) {
      return async (args) =>
        `[模拟执行] 命令 "${args.command}" 执行成功，退出码 0。输出：模拟命令输出。（Mock Mode）`;
    }
    if (toolName.startsWith('http/')) {
      return async (args) =>
        `[模拟HTTP] ${args.url} 返回状态码 200，响应体：{"status":"ok"}（Mock Mode）`;
    }
    if (toolName.startsWith('browser/')) {
      return async (args) => `[模拟浏览器] 已导航到 ${args.url}，页面标题：模拟页面（Mock Mode）`;
    }
    if (toolName.startsWith('memory_search/')) {
      return async (args) =>
        `[模拟搜索] 查询 "${args.query}" 返回 3 条结果：1. 相关文档A, 2. 相关文档B, 3. 相关文档C（Mock Mode）`;
    }
    return async () => `[模拟] 工具 ${toolName} 执行完成。（Mock Mode）`;
  }
}

// ═══════════════════════════════════════════════════════════════
// MockSkillRegistry — 模拟技能注册中心
// ═══════════════════════════════════════════════════════════════

/**
 * 模拟技能注册中心
 *
 * 提供预置的技能描述列表供 LLM 系统提示词使用。
 */
export class MockSkillRegistry {
  private skills: Skill[];

  constructor(skills?: Skill[]) {
    this.skills = skills ?? [
      {
        meta: {
          name: 'daily-summary',
          description: '每日任务总结技能，根据用户当天的操作记录生成日报',
          version: '1.0.0',
          requires: [],
        },
        content: '# daily-summary\n生成每日任务总结报告。',
        filePath: 'skills/examples/daily-summary/SKILL.md',
      },
      {
        meta: {
          name: 'text-translation',
          description: '文本翻译技能，支持中英日韩等多语言互译',
          version: '1.0.0',
          requires: [],
        },
        content: '# text-translation\n将文本在多种语言之间翻译。',
        filePath: 'skills/examples/text-translation/SKILL.md',
      },
      {
        meta: {
          name: 'web-search',
          description: '网页搜索技能，帮助用户在互联网上搜索最新信息',
          version: '1.0.0',
          requires: [],
        },
        content: '# web-search\n搜索互联网上的最新信息。',
        filePath: 'skills/examples/web-search/SKILL.md',
      },
    ];
  }

  /** 获取所有已注册技能 */
  listAll(): Skill[] {
    return [...this.skills];
  }

  /** 获取指定技能 */
  get(name: string): Skill | undefined {
    return this.skills.find((s) => s.meta.name === name);
  }

  /** 注册自定义技能 */
  register(skill: Skill): void {
    this.skills.push(skill);
    log.debug({ name: skill.meta.name }, '[Mock] 技能已注册');
  }
}

// ═══════════════════════════════════════════════════════════════
// MockVectorMemory — 模拟向量记忆
// ═══════════════════════════════════════════════════════════════

/**
 * 模拟向量记忆
 *
 * 为长期记忆检索提供占位实现。
 */
export class MockVectorMemory {
  private memories: Array<{ content: string; score: number }>;

  constructor() {
    this.memories = [
      { content: '[记忆] 用户偏好使用简短回复', score: 0.9 },
      { content: '[记忆] 用户通常在工作目录 d:\\templates 下操作', score: 0.8 },
    ];
  }

  /**
   * 搜索相关记忆
   *
   * @param _query 搜索查询（当前未使用真实向量搜索）
   * @param topK 返回结果数
   * @returns 相关记忆内容列表
   */
  async search(_query: string, topK: number = 5): Promise<string[]> {
    // 模拟：始终返回预置记忆
    return this.memories.slice(0, topK).map((m) => m.content);
  }

  /**
   * 存储记忆
   *
   * @param content 记忆内容
   * @param _vector 向量（模拟中未使用）
   */
  async store(content: string, _vector?: number[]): Promise<void> {
    this.memories.push({ content, score: 0.5 });
    log.debug('[Mock] 记忆已存储');
  }

  /** 清空所有记忆 */
  clear(): void {
    this.memories = [];
  }
}

// ═══════════════════════════════════════════════════════════════
// MockSessionMemory — 用于测试的增强版会话记忆
// ═══════════════════════════════════════════════════════════════

/** 消息记录 */
interface SessionMessage {
  role: string;
  content: string;
  timestamp: number;
}

/**
 * 模拟会话记忆（增强版）
 *
 * 用于 Orchestrator 测试时提供更完整的会话上下文管理。
 */
export class MockSessionMemory {
  private cache = new Map<string, SessionMessage[]>();

  /** 读取会话消息 */
  async read(sessionId: string): Promise<SessionMessage[]> {
    return this.cache.get(sessionId) ?? [];
  }

  /** 追加会话消息 */
  async append(sessionId: string, message: SessionMessage): Promise<void> {
    const messages = this.cache.get(sessionId) ?? [];
    messages.push(message);
    this.cache.set(sessionId, messages);
  }

  /** 分页读取历史消息 */
  async readHistory(
    sessionId: string,
    offset: number = 0,
    limit: number = 50,
  ): Promise<{ messages: SessionMessage[]; total: number }> {
    const messages = this.cache.get(sessionId) ?? [];
    const total = messages.length;
    const sliced = messages.slice(Math.max(0, total - offset - limit), total - offset);
    return { messages: sliced, total };
  }

  /** 清空会话 */
  clear(sessionId?: string): void {
    if (sessionId) {
      this.cache.delete(sessionId);
    } else {
      this.cache.clear();
    }
  }
}
