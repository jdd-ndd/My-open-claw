/**
 * MemoryManager — 记忆模块统一管理门面
 *
 * 对齐文档 docs/07-Memory记忆模块.md §3.4
 *
 * 职责：
 *   - 作为 Session / Vector / Persist 三层的统一入口
 *   - 提供 initialize / shutdown 生命周期管理
 *   - 提供 remember / recall 便捷方法
 *   - 提供 cleanExpired / cleanLowImportance 维护方法
 *
 * @module @myopenclaw/server/memory
 */

import { createLogger } from '../core/utils/logger.js';
import { EmbeddingService } from './embedding.js';
import { PersistLayer } from './persist.js';
import { VectorMemory } from './vector.js';
import { SessionMemory } from './session.js';
import type {
  SessionMessage,
  RememberOptions,
  RecallResult,
  EmbeddingServiceConfig,
} from './types.js';

const log = createLogger('memory:manager');

// ═══════════════════════════════════════════════════════════════
// MemoryManager 配置
// ═══════════════════════════════════════════════════════════════

/** MemoryManager 配置选项 */
export interface MemoryManagerOptions {
  /** Embedding 服务配置（不传则使用关键词回退模式） */
  embedding?: EmbeddingServiceConfig;
  /** 数据持久化目录（不传则使用默认路径） */
  dataDir?: string;
  /** 会话最大消息数（触发压缩），默认 50 */
  sessionMaxMessages?: number;
  /** 会话 TTL（秒），默认 86400（24小时） */
  sessionTtlSeconds?: number;
}

// ═══════════════════════════════════════════════════════════════
// MemoryManager 核心类
// ═══════════════════════════════════════════════════════════════

export class MemoryManager {
  /** 短期会话记忆 */
  readonly session: SessionMemory;

  /** 长期向量记忆 */
  readonly vector: VectorMemory;

  /** 持久化层 */
  readonly persist: PersistLayer;

  /** 嵌入服务 */
  readonly embedding: EmbeddingService;

  private initialized = false;

  constructor(options: MemoryManagerOptions = {}) {
    // 初始化持久化层
    this.persist = new PersistLayer(options.dataDir);

    // 初始化嵌入服务
    this.embedding = new EmbeddingService(options.embedding);

    // 初始化向量记忆
    this.vector = new VectorMemory(this.embedding, this.persist);

    // 初始化会话记忆
    this.session = new SessionMemory(this.persist, {
      maxMessages: options.sessionMaxMessages,
      ttlSeconds: options.sessionTtlSeconds,
    });
  }

  // ═════════════════════════════════════════════════════════════
  // 生命周期
  // ═════════════════════════════════════════════════════════════

  /**
   * 初始化 Memory 模块
   *
   * 加载持久化数据到内存，建立向量索引。
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 1. 初始化持久化层
    await this.persist.initialize();

    // 2. 从持久化加载会话和向量数据
    await Promise.all([
      this.session.load(),
      this.vector.load(),
    ]);

    this.initialized = true;
    log.info({
      sessionCount: this.session.activeCount,
      vectorCount: this.vector.size,
      embeddingProvider: this.embedding.provider,
      embeddingAvailable: this.embedding.available,
    }, 'Memory 模块初始化完成');
  }

  /**
   * 关闭 Memory 模块
   *
   * 刷新所有缓冲区，关闭连接。
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    await this.persist.close();
    this.initialized = false;
    log.info('Memory 模块已关闭');
  }

  // ═════════════════════════════════════════════════════════════
  // 便捷方法
  // ═════════════════════════════════════════════════════════════

  /**
   * 记忆写入快捷方法
   *
   * 同时写入短期会话记忆，并可选择性地存入长期向量记忆。
   *
   * @param sessionId 会话 ID
   * @param message 消息内容
   * @param options 写入选项
   */
  async remember(
    sessionId: string,
    message: SessionMessage,
    options: RememberOptions = {},
  ): Promise<void> {
    // 1. 写入短期会话记忆
    await this.session.append(sessionId, message);

    // 2. 可选：写入长期向量记忆
    if (options.storeVector) {
      // 获取会话信息以获取 userId 等元数据
      const sessionData = await this.session.read(sessionId);

      await this.vector.store({
        content: message.content,
        metadata: {
          sessionId,
          userId: sessionData?.userId ?? 'unknown',
          type: options.type ?? 'conversation',
          importance: options.importance ?? 0.5,
          tags: options.tags,
          createdAt: message.timestamp || Date.now(),
        },
      });
    }
  }

  /**
   * 记忆检索快捷方法
   *
   * 同时检索短期会话上下文和长期向量记忆。
   *
   * @param sessionId 会话 ID
   * @param query 检索查询（自然语言）
   * @param topK 向量检索返回数量，默认 5
   * @returns 会话上下文 + 匹配的长期记忆
   */
  async recall(
    sessionId: string,
    query: string,
    topK = 5,
  ): Promise<RecallResult> {
    // 并行检索短期和长期记忆
    const [sessionData, vectors] = await Promise.all([
      this.session.read(sessionId),
      this.vector.search(query, { topK, threshold: 0 }),
    ]);

    return { session: sessionData, vectors };
  }

  // ═════════════════════════════════════════════════════════════
  // 维护方法
  // ═════════════════════════════════════════════════════════════

  /**
   * 清理过期数据
   *
   * @returns 清理统计
   */
  async cleanExpired(): Promise<{ sessions: number; vectors: number }> {
    const [sessions, vectors] = await Promise.all([
      this.session.cleanupExpired(),
      this.vector.cleanupLowImportance(0.3, 30 * 24 * 3600 * 1000),
    ]);

    if (sessions > 0 || vectors > 0) {
      log.info({ sessions, vectors }, '过期数据清理完成');
    }

    return { sessions, vectors };
  }
}
