/**
 * VectorMemory — 长期向量记忆存储
 *
 * 对齐文档 docs/07-Memory记忆模块.md §2.2
 *
 * 职责：
 *   - 将文本内容向量化存储
 *   - 支持基于语义相似度的检索（余弦相似度）
 *   - 支持元数据过滤（sessionId / userId / type / tags / 时间范围）
 *   - 支持 CRUD 与批量操作
 *   - 自动持久化到本地文件
 *
 * 存储后端：本地内存 + JSON 文件持久化
 * 相似度算法：默认余弦相似度，可选欧氏距离、点积
 *
 * @module @myopenclaw/server/memory
 */

import { createLogger } from '../core/utils/logger.js';
import { generateId } from '../core/utils/id.js';
import { EmbeddingService } from './embedding.js';
import { PersistLayer } from './persist.js';
import type {
  VectorMemoryEntry,
  VectorStoreInput,
  VectorSearchOptions,
  VectorUpdateInput,
  VectorDeleteFilter,
  VectorCountFilter,
} from './types.js';

const log = createLogger('memory:vector');

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** 持久化键前缀 */
const PERSIST_KEY = 'vectors/index';

/** 默认 TopK */
const DEFAULT_TOP_K = 5;

/** 默认相似度阈值 */
const DEFAULT_THRESHOLD = 0;

// ═══════════════════════════════════════════════════════════════
// 向量相似度计算
// ═══════════════════════════════════════════════════════════════

/**
 * 余弦相似度
 *
 * cos(A, B) = (A · B) / (|A| × |B|)
 * 取值范围 [-1, 1]，归一化后等价于点积
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * 欧氏距离 → 相似度
 *
 * similarity = 1 / (1 + distance)
 * 距离越小 → 相似度越高（值域 [0, 1]）
 */
function euclideanSimilarity(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return 1 / (1 + Math.sqrt(sum));
}

/**
 * 点积相似度（适用于已归一化向量）
 */
function dotProductSimilarity(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/** 相似度算法映射 */
const SIMILARITY_FNS = {
  cosine: cosineSimilarity,
  euclidean: euclideanSimilarity,
  dotProduct: dotProductSimilarity,
} as const;

// ═══════════════════════════════════════════════════════════════
// VectorMemory 核心类
// ═══════════════════════════════════════════════════════════════

export class VectorMemory {
  /** 嵌入服务 */
  private embedding: EmbeddingService;

  /** 持久化层（可选） */
  private persist?: PersistLayer;

  /** 内存中的向量索引 */
  private entries = new Map<string, VectorMemoryEntry>();

  /** 是否已从持久化加载 */
  private loaded = false;

  constructor(embedding: EmbeddingService, persist?: PersistLayer) {
    this.embedding = embedding;
    this.persist = persist;
  }

  // ═════════════════════════════════════════════════════════════
  // 生命周期
  // ═════════════════════════════════════════════════════════════

  /**
   * 从持久化加载向量索引
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    if (!this.persist) {
      this.loaded = true;
      return;
    }

    try {
      const data = await this.persist.read<Array<VectorMemoryEntry>>(PERSIST_KEY);
      if (data && Array.isArray(data)) {
        for (const entry of data) {
          this.entries.set(entry.id, entry);
        }
        log.info({ count: data.length }, '向量索引已从持久化加载');
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, '向量索引加载失败，使用空索引');
    }

    this.loaded = true;
  }

  /**
   * 持久化向量索引
   */
  private async save(): Promise<void> {
    if (!this.persist) return;
    try {
      const data = Array.from(this.entries.values());
      await this.persist.write(PERSIST_KEY, data);
    } catch (err) {
      log.warn({ err: (err as Error).message }, '向量索引持久化失败');
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 存储
  // ═════════════════════════════════════════════════════════════

  /**
   * 存储单条记忆
   *
   * @param input 存储输入
   * @returns 记忆 ID
   */
  async store(input: VectorStoreInput): Promise<string> {
    const id = generateId();
    const now = Date.now();

    // 生成向量
    let embeddingVector: number[];
    if (input.embedding) {
      embeddingVector = input.embedding;
    } else {
      embeddingVector = await this.embedding.computeEmbedding(input.content);
    }

    const entry: VectorMemoryEntry = {
      id,
      content: input.content,
      embedding: embeddingVector,
      dimension: embeddingVector.length,
      metadata: {
        ...input.metadata,
        importance: input.metadata.importance ?? 0.5,
        createdAt: input.metadata.createdAt ?? now,
      },
    };

    this.entries.set(id, entry);

    // 异步持久化
    this.save().catch((err) => {
      log.warn({ err: (err as Error).message }, '存储后持久化失败');
    });

    log.debug({ id, content: input.content.slice(0, 50) }, '向量记忆已存储');
    return id;
  }

  /**
   * 批量存储记忆
   *
   * @param inputs 存储输入列表
   * @returns 记忆 ID 列表
   */
  async storeBatch(inputs: VectorStoreInput[]): Promise<string[]> {
    const ids: string[] = [];
    const now = Date.now();

    // 批量生成向量
    const textsWithoutEmbedding = inputs
      .filter((input) => !input.embedding)
      .map((input) => input.content);
    const computedEmbeddings = textsWithoutEmbedding.length > 0
      ? await this.embedding.computeBatch(textsWithoutEmbedding)
      : [];

    let embIdx = 0;
    for (const input of inputs) {
      const id = generateId();
      const embeddingVector = input.embedding ?? computedEmbeddings[embIdx++];

      const entry: VectorMemoryEntry = {
        id,
        content: input.content,
        embedding: embeddingVector,
        dimension: embeddingVector.length,
        metadata: {
          ...input.metadata,
          importance: input.metadata.importance ?? 0.5,
          createdAt: input.metadata.createdAt ?? now,
        },
      };

      this.entries.set(id, entry);
      ids.push(id);
    }

    // 异步持久化
    this.save().catch((err) => {
      log.warn({ err: (err as Error).message }, '批量存储后持久化失败');
    });

    log.info({ count: ids.length }, '向量记忆批量存储完成');
    return ids;
  }

  // ═════════════════════════════════════════════════════════════
  // 检索
  // ═════════════════════════════════════════════════════════════

  /**
   * 语义检索
   *
   * @param query 检索查询（自然语言）
   * @param options 检索选项
   * @returns 匹配的记忆列表（按相似度降序）
   */
  async search(
    query: string,
    options: VectorSearchOptions = {},
  ): Promise<VectorMemoryEntry[]> {
    const {
      topK = DEFAULT_TOP_K,
      threshold = DEFAULT_THRESHOLD,
      sessionId,
      userId,
      type,
      timeRange,
      tags,
      similarity = 'cosine',
    } = options;

    if (this.entries.size === 0) return [];

    // 生成查询向量
    const queryEmbedding = await this.embedding.computeEmbedding(query);

    // 计算所有条目的相似度
    const simFn = SIMILARITY_FNS[similarity];
    const scored: Array<{ entry: VectorMemoryEntry; score: number }> = [];

    for (const entry of this.entries.values()) {
      if (entry.embedding.length !== queryEmbedding.length) continue;

      // 元数据过滤
      if (sessionId && entry.metadata.sessionId !== sessionId) continue;
      if (userId && entry.metadata.userId !== userId) continue;
      if (type && entry.metadata.type !== type) continue;
      if (timeRange) {
        const createdAt = entry.metadata.createdAt ?? 0;
        if (timeRange.start && createdAt < timeRange.start) continue;
        if (timeRange.end && createdAt > timeRange.end) continue;
      }
      if (tags && tags.length > 0) {
        const entryTags = entry.metadata.tags ?? [];
        if (!tags.some((t) => entryTags.includes(t))) continue;
      }

      const score = simFn(queryEmbedding, entry.embedding);
      if (score < threshold) continue;

      scored.push({ entry: { ...entry, score }, score });
    }

    // 按相似度降序排序
    scored.sort((a, b) => b.score - a.score);

    // 取 TopK
    return scored.slice(0, topK).map((item) => item.entry);
  }

  // ═════════════════════════════════════════════════════════════
  // CRUD
  // ═════════════════════════════════════════════════════════════

  /**
   * 按 ID 获取记忆
   */
  async get(id: string): Promise<VectorMemoryEntry | null> {
    return this.entries.get(id) ?? null;
  }

  /**
   * 更新记忆
   *
   * 如果更新了内容，自动重新生成向量。
   */
  async update(id: string, update: VectorUpdateInput): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(`记忆不存在: ${id}`);
    }

    if (update.content !== undefined) {
      entry.content = update.content;
      // 内容变更 → 重新生成向量
      entry.embedding = await this.embedding.computeEmbedding(update.content);
      entry.dimension = entry.embedding.length;
    }

    if (update.metadata) {
      entry.metadata = { ...entry.metadata, ...update.metadata };
    }

    this.entries.set(id, entry);

    // 异步持久化
    this.save().catch((err) => {
      log.warn({ err: (err as Error).message }, '更新后持久化失败');
    });

    log.debug({ id }, '向量记忆已更新');
  }

  /**
   * 删除记忆
   */
  async delete(id: string): Promise<boolean> {
    const existed = this.entries.delete(id);
    if (existed) {
      this.save().catch((err) => {
        log.warn({ err: (err as Error).message }, '删除后持久化失败');
      });
    }
    return existed;
  }

  /**
   * 按过滤条件批量删除
   *
   * @param filter 删除过滤条件
   * @returns 删除的记忆数量
   */
  async deleteByFilter(filter: VectorDeleteFilter): Promise<number> {
    const toDelete: string[] = [];

    for (const [id, entry] of this.entries) {
      if (filter.sessionId && entry.metadata.sessionId !== filter.sessionId) continue;
      if (filter.userId && entry.metadata.userId !== filter.userId) continue;
      if (filter.type && entry.metadata.type !== filter.type) continue;
      if (filter.timeRange) {
        const createdAt = entry.metadata.createdAt ?? 0;
        if (filter.timeRange.start && createdAt < filter.timeRange.start) continue;
        if (filter.timeRange.end && createdAt > filter.timeRange.end) continue;
      }
      toDelete.push(id);
    }

    for (const id of toDelete) {
      this.entries.delete(id);
    }

    if (toDelete.length > 0) {
      this.save().catch((err) => {
        log.warn({ err: (err as Error).message }, '批量删除后持久化失败');
      });
    }

    log.info({ deleted: toDelete.length, filter }, '按条件批量删除完成');
    return toDelete.length;
  }

  /**
   * 获取记忆总数
   */
  async count(filter?: VectorCountFilter): Promise<number> {
    if (!filter) return this.entries.size;

    let count = 0;
    for (const entry of this.entries.values()) {
      if (filter.sessionId && entry.metadata.sessionId !== filter.sessionId) continue;
      if (filter.userId && entry.metadata.userId !== filter.userId) continue;
      if (filter.type && entry.metadata.type !== filter.type) continue;
      count++;
    }
    return count;
  }

  /**
   * 清理低重要性记忆
   *
   * @param threshold 重要性阈值（0-1），低于此值的记忆被清理
   * @param maxAgeMs 最大存活时间（毫秒），超过此时间的记忆也可能被清理
   * @returns 清理的记忆数量
   */
  async cleanupLowImportance(threshold: number, maxAgeMs?: number): Promise<number> {
    const toDelete: string[] = [];
    const now = Date.now();

    for (const [id, entry] of this.entries) {
      const importance = entry.metadata.importance ?? 0.5;
      const createdAt = entry.metadata.createdAt ?? 0;

      // 重要性低于阈值
      if (importance < threshold) {
        // 如果设置了 maxAge，且记忆还未过期，则保留
        if (maxAgeMs && (now - createdAt) < maxAgeMs) continue;
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.entries.delete(id);
    }

    if (toDelete.length > 0) {
      this.save().catch((err) => {
        log.warn({ err: (err as Error).message }, '清理后持久化失败');
      });
    }

    log.info({ cleaned: toDelete.length, threshold, maxAgeMs }, '低重要性记忆清理完成');
    return toDelete.length;
  }

  /**
   * 获取条目总数（不含过滤）
   */
  get size(): number {
    return this.entries.size;
  }
}
