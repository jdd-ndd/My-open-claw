/**
 * Agent Runtime Adapter
 *
 * 将 AgentOrchestrator 适配为 AgentBridge 期望的 AgentRuntime 接口,
 * 并把 orchestrator 的运行结果转换成 AgentBridge 的 Message 格式。
 *
 * 依赖注入策略:
 * - 推荐用 `await AgentRuntimeAdapter.create(opts)` 异步创建,
 *   内部自动装载真实 ToolRegistry(13 个内置工具) + SkillRegistry(扫描 skills/ 目录)
 * - 兼容:直接 `new AgentRuntimeAdapter(opts)` 会走 Orchestrator 默认值(Mock),
 *   仅用于单元测试和不想挂真实工具的场景
 *
 * 设计要点:
 * - 接受同步的 processMessage(Message) -> Promise<Message>
 * - 返回的 Message 必须含 content (LLM 实际回复) + agentId
 * - 流式支持: 当前 orchestrator.run() 一次性返回完整 reply,
 *   因此本适配器把完整 reply 作为单个 Message.content 返回,
 *   由 websocket-handler 自行切分为 chat.delta event
 *
 * 后续升级:
 * - 若 orchestrator 增加 streamStep / onPartialReply 钩子,
 *   可在本适配器内即时推送 partial → 由 handler 转为 chat.delta
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import type { Message } from '../../core/types/message.js';
import { createLogger } from '../../core/utils/logger.js';
import { AgentOrchestrator } from '../../agents/orchestrator.js';
import { LLMAdapterFactory } from '../../agents/llm/factory.js';
import { loadAgentConfig } from '../../core/config/loader.js';
import type { ToolRegistry } from '../../tools/index.js';
import { createToolRegistry } from '../../tools/index.js';
import { SkillRegistry } from '../../skills/registry.js';
import { SkillLoader } from '../../skills/loader.js';
import { MemoryManager } from '../../memory/manager.js';
import type { AgentRuntime } from '../agent-bridge.js';
import type { LLMAdapter } from '../../agents/llm/types.js';

const log = createLogger('gateway:runtime-adapter');

export interface AdapterOptions {
  /** 注入的 orchestrator(优先级最高) */
  orchestrator?: AgentOrchestrator;
  /** Agent ID (默认 'default',用于查找 YAML 配置) */
  agentId?: string;
  /** 注入工具注册中心(测试用;不传则用 createToolRegistry 默认装载 13 个内置工具) */
  toolRegistry?: ToolRegistry;
  /** 注入技能注册中心(测试用;不传则自动扫描项目 skills/ 目录) */
  skillRegistry?: SkillRegistry;
  /** 注入记忆管理器(不传则自动创建,数据目录为项目 data/memory/) */
  memory?: MemoryManager;
}

export class AgentRuntimeAdapter implements AgentRuntime {
  private readonly orchestrator: AgentOrchestrator;
  private readonly memory?: MemoryManager;

  /**
   * 同步构造(向后兼容 + 单元测试用)
   * 默认走 Orchestrator 内部默认值(目前为 MockToolRegistry / MockSkillRegistry),
   * 生产环境请改用 `await AgentRuntimeAdapter.create(opts)`
   */
  constructor(opts: AdapterOptions = {}) {
    this.memory = opts.memory;
    if (opts.orchestrator) {
      this.orchestrator = opts.orchestrator;
    } else {
      const agentId = opts.agentId ?? 'default';
      const llmAdapter = this.createLLMAdapter(agentId);
      this.orchestrator = new AgentOrchestrator({ llm: llmAdapter });
    }
    log.info('AgentRuntimeAdapter 已创建(同步路径)');
  }

  /**
   * 异步工厂(推荐用法)
   *
   * 创建带真实 ToolRegistry(13 个内置工具)+ SkillRegistry(扫描项目 skills/)的 adapter
   *
   * @example
   * ```ts
   * const adapter = await AgentRuntimeAdapter.create();
   * server.bind(adapter);
   * ```
   */
  static async create(opts: AdapterOptions = {}): Promise<AgentRuntimeAdapter> {
    if (opts.orchestrator) {
      return new AgentRuntimeAdapter({ orchestrator: opts.orchestrator });
    }
    const agentId = opts.agentId ?? 'default';
    const llmAdapter = AgentRuntimeAdapter.createLLMAdapterStatic(agentId);
    const memory = opts.memory ?? await AgentRuntimeAdapter.createDefaultMemory();
    const toolRegistry = opts.toolRegistry ?? (await createToolRegistry({ memory }));
    const skillRegistry = opts.skillRegistry ?? AgentRuntimeAdapter.createDefaultSkillRegistry();

    // 创建 MemoryManager 并初始化


    const orchestrator = new AgentOrchestrator({
      llm: llmAdapter,
      toolRegistry,
      skillRegistry,
      sessionMemory: memory.session,
      vectorMemory: memory.vector,
    });
    return new AgentRuntimeAdapter({ orchestrator, memory });
  }

  /**
   * 默认 skill 目录:扫描 server 根的 skills/ 目录
   * 路径计算:从 server/src/gateway/server/agent-runtime-adapter.ts 回溯 3 层到 server 根
   * 可被 MYOC_PROJECT_SKILLS_DIR 环境变量覆盖(用于自定义部署和测试)
   */
  static createDefaultSkillRegistry(): SkillRegistry {
    // 优先级: MYOC_PROJECT_SKILLS_DIR > 默认 server/skills/
    let skillsDir: string;
    if (process.env.MYOC_PROJECT_SKILLS_DIR) {
      skillsDir = resolve(process.env.MYOC_PROJECT_SKILLS_DIR);
    } else {
      const here = dirname(fileURLToPath(import.meta.url));
      // here = server/src/gateway/server
      // 回溯 3 层 → server/, 然后 + 'skills' → server/skills
      const serverRoot = resolve(here, '..', '..', '..');
      skillsDir = resolve(serverRoot, 'skills');
    }
    if (!existsSync(skillsDir)) {
      log.warn({ skillsDir }, 'skills 目录不存在,使用空 registry');
      return new SkillRegistry();
    }
    const registry = new SkillRegistry(new SkillLoader());
    const count = registry.loadFromDirectory(skillsDir);
    log.info({ skillsDir, count }, '已加载项目级 skills');
    return registry;
  }

  /**
   * 默认 Memory 管理器
   *
   * 数据目录: MYOC_MEMORY_DIR 环境变量 > server/data/memory/
   * Embedding: 使用环境变量配置(OPENAI_API_KEY 等),未配则关键词回退
   */
  static async createDefaultMemory(): Promise<MemoryManager> {
    let dataDir: string;
    if (process.env.MYOC_MEMORY_DIR) {
      dataDir = resolve(process.env.MYOC_MEMORY_DIR);
    } else {
      const here = dirname(fileURLToPath(import.meta.url));
      const serverRoot = resolve(here, '..', '..', '..');
      dataDir = resolve(serverRoot, 'data', 'memory');
    }

    const embeddingConfig = {
      provider: (process.env.EMBEDDING_PROVIDER as 'openai' | 'cohere' | 'local') ?? 'local',
      apiKey: process.env.OPENAI_API_KEY ?? process.env.EMBEDDING_API_KEY,
      baseUrl: process.env.EMBEDDING_BASE_URL ?? process.env.OPENAI_BASE_URL,
      model: process.env.EMBEDDING_MODEL,
      dimensions: process.env.EMBEDDING_DIMENSIONS ? Number(process.env.EMBEDDING_DIMENSIONS) : undefined,
      batchSize: process.env.EMBEDDING_BATCH_SIZE ? Number(process.env.EMBEDDING_BATCH_SIZE) : undefined,
    };

    const memory = new MemoryManager({
      dataDir,
      embedding: embeddingConfig,
    });

    await memory.initialize();
    return memory;
  }

  /** 静态方法:不依赖实例即可从 YAML 创建 LLM adapter(供 create() 调用) */
  private static createLLMAdapterStatic(agentId: string): LLMAdapter {
    const agentConfig = loadAgentConfig(agentId);
    if (agentConfig) {
      log.info({ agentId, configId: agentConfig.id }, '从 YAML 配置加载 Agent LLM 参数');
      try {
        return LLMAdapterFactory.fromAgentConfig(agentConfig);
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'YAML 配置创建 LLM 适配器失败, 使用环境变量兜底');
      }
    }
    log.info('使用环境变量创建 LLM 适配器');
    return LLMAdapterFactory.create({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      timeoutMs: 60_000,
    });
  }

  /**
   * 从 YAML 配置创建 LLM 适配器
   * 优先使用 config/agents/default.yaml 中的配置,
   * 兜底使用环境变量。
   */
  private createLLMAdapter(agentId: string): LLMAdapter {
    return AgentRuntimeAdapter.createLLMAdapterStatic(agentId);
  }

  async processMessage(message: Message): Promise<Message> {
    log.info(
      { agentId: message.agentId, channelId: message.channelId, userId: message.userId, len: message.content.length },
      '收到消息,转交 Orchestrator',
    );

    const startedAt = Date.now();
    const reply = await this.orchestrator.processMessage(message);
    log.info(
      { agentId: message.agentId, durationMs: Date.now() - startedAt, replyLen: reply.content.length },
      'Orchestrator 处理完成',
    );

    // AgentBridge 期望返回的 Message 必须有 id,channelId,userId,timestamp
    return {
      ...reply,
      id: reply.id || `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      channelId: message.channelId,
      userId: message.userId,
      agentId: message.agentId,
      sessionId: message.sessionId,
      timestamp: Date.now(),
      role: 'agent',
    };
  }

  /** 暴露内部 orchestrator(供测试 / 高级用法) */
  getOrchestrator(): AgentOrchestrator {
    return this.orchestrator;
  }

  getMemory(): MemoryManager | undefined {
    return this.memory;
  }
}
