/**
 * 记忆检索工具（对齐文档 docs/07-Memory记忆模块.md §8）
 *
 * 封装 Memory 层的向量检索能力，作为内置 Tool 提供给 Agent 调用。
 *
 * 支持两种模式：
 *   1. 真实模式：传入 VectorMemory 实例，执行语义向量检索
 *   2. 模拟模式：未传入 VectorMemory 时，使用内置模拟记忆（用于演示和测试）
 *
 * @module @myopenclaw/server/tools/memory_search
 */

import { createLogger } from '../../core/utils/logger.js';
import type { VectorMemory } from '../../memory/vector.js';
import type { Tool, ToolResult, InvokeContext, JSONSchema } from '../../core/types/index.js';
import type { VectorSearchOptions } from '../../memory/types.js';

const log = createLogger('tools:memory_search');

// ═══════════════════════════════════════════════════════════════
// memory_search/search —— 记忆检索
// ═══════════════════════════════════════════════════════════════

export class MemorySearchTool implements Tool {
  readonly name = 'memory_search/search';
  readonly description = '从长期向量记忆中检索与查询语句语义相关的历史对话和记忆。用于回忆之前的对话内容、历史任务或用户偏好。';
  readonly category = 'memory_search';
  readonly risk: 'low' | 'medium' | 'high' = 'low';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '检索查询语句（自然语言描述要查找的内容）',
      },
      topK: {
        type: 'number',
        description: '返回最相关的 K 条记忆，默认 5',
        default: 5,
      },
      sessionId: {
        type: 'string',
        description: '限定在指定会话范围内检索（不填则全局检索）',
      },
      threshold: {
        type: 'number',
        description: '相似度阈值（0-1），低于此值的记忆不返回，默认 0.3',
        default: 0.3,
      },
    },
    required: ['query'],
  };

  /** 真实向量记忆（可选，不传入则使用模拟数据） */
  private vectorMemory?: VectorMemory;

  /** 模拟记忆存储（降级方案） */
  private simulatedMemories: Array<{
    id: string;
    content: string;
    score: number;
    timestamp: string;
    sessionId: string;
  }> = [
    {
      id: 'mem-001',
      content: '用户偏好使用 TypeScript 进行开发，项目结构为 monorepo',
      score: 0.95,
      timestamp: '2026-07-20T10:30:00Z',
      sessionId: 'session-001',
    },
    {
      id: 'mem-002',
      content: '之前配置了 DeepSeek API，使用环境变量 DEEPSEEK_API_KEY 存储密钥',
      score: 0.88,
      timestamp: '2026-07-21T14:20:00Z',
      sessionId: 'session-001',
    },
    {
      id: 'mem-003',
      content: '用户习惯使用中文交互，项目文档也要求中文注释',
      score: 0.92,
      timestamp: '2026-07-22T09:15:00Z',
      sessionId: 'session-002',
    },
    {
      id: 'mem-004',
      content: '上次任务是对文件操作工具进行了重构，将 FsTool 拆分为四个独立工具',
      score: 0.85,
      timestamp: '2026-07-23T16:45:00Z',
      sessionId: 'session-003',
    },
    {
      id: 'mem-005',
      content: 'MyOpenClaw 项目采用六层架构：Gateway→Channels→Hooks→Agents→Tools/Skills→Memory',
      score: 0.78,
      timestamp: '2026-07-25T11:00:00Z',
      sessionId: 'session-004',
    },
  ];

  constructor(vectorMemory?: VectorMemory) {
    this.vectorMemory = vectorMemory;
    if (vectorMemory) {
      log.info('记忆检索工具已接入真实 VectorMemory');
    } else {
      log.info('记忆检索工具使用模拟数据模式');
    }
  }

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startTime = Date.now();
    const query = String(params.query);
    const topK = (params.topK as number) ?? 5;
    const sessionId = params.sessionId as string | undefined;
    const threshold = (params.threshold as number) ?? 0.3;

    try {
      if (this.vectorMemory) {
        // ══ 真实模式：调用 VectorMemory.search() ══
        const searchOptions: VectorSearchOptions = {
          topK,
          threshold,
          sessionId,
        };

        const results = await this.vectorMemory.search(query, searchOptions);

        log.info({ query, resultCount: results.length, topK, mode: 'vector' }, '记忆检索完成（向量模式）');

        return {
          success: true,
          status: 'success',
          data: results.map((entry) => ({
            id: entry.id,
            content: entry.content,
            score: entry.score ?? 0,
            timestamp: entry.metadata.createdAt
              ? new Date(entry.metadata.createdAt).toISOString()
              : new Date().toISOString(),
            sessionId: entry.metadata.sessionId,
            type: entry.metadata.type,
            tags: entry.metadata.tags,
          })),
          metadata: {
            durationMs: Date.now() - startTime,
            sideEffects: [],
            resources: { totalMemories: this.vectorMemory.size, matched: results.length },
          },
        };
      } else {
        // ══ 模拟模式：基于关键词匹配 ══
        let filtered = this.simulatedMemories.filter((mem) => {
          const queryLower = query.toLowerCase();
          const contentLower = mem.content.toLowerCase();
          const queryWords = queryLower.split(/\s+/);
          const matchCount = queryWords.filter((w) => contentLower.includes(w)).length;
          const matchScore = matchCount / queryWords.length;
          return matchScore >= threshold;
        });

        if (sessionId) {
          filtered = filtered.filter((mem) => mem.sessionId === sessionId);
        }

        filtered.sort((a, b) => b.score - a.score);
        const results = filtered.slice(0, topK).map((mem) => ({
          id: mem.id,
          content: mem.content,
          score: mem.score,
          timestamp: mem.timestamp,
          sessionId: mem.sessionId,
        }));

        log.info({ query, resultCount: results.length, topK, mode: 'simulated' }, '记忆检索完成（模拟模式）');

        return {
          success: true,
          status: 'success',
          data: results,
          metadata: {
            durationMs: Date.now() - startTime,
            sideEffects: [],
            resources: { totalMemories: this.simulatedMemories.length, matched: results.length },
          },
        };
      }
    } catch (err) {
      log.error({ query, err: (err as Error).message }, '记忆检索失败');
      return {
        success: false,
        status: 'error',
        error: `记忆检索失败: ${(err as Error).message}`,
        errorCode: 'MEMORY_SEARCH_ERROR',
        metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
      };
    }
  }

  /** 添加模拟记忆（用于测试，仅在模拟模式下有效） */
  addMemory(content: string, sessionId = 'default'): void {
    this.simulatedMemories.push({
      id: `mem-${this.simulatedMemories.length + 1}`.padStart(7, '0'),
      content,
      score: 0.7 + Math.random() * 0.3,
      timestamp: new Date().toISOString(),
      sessionId,
    });
  }

  /** 清空模拟记忆 */
  clearMemories(): void {
    this.simulatedMemories = [];
  }
}
