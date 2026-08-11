/**
 * EmbeddingService — 文本向量嵌入计算服务
 *
 * 对齐文档 docs/07-Memory记忆模块.md §4.1
 *
 * 职责：将文本转换为固定维度向量，支持：
 *   1. OpenAI 兼容 API（OpenAI / DeepSeek / 本地 Ollama 等）
 *   2. 关键词回退模式（未配置 API 时，基于 TF-IDF 思想的词频向量）
 *   3. LRU 缓存，避免重复计算
 *   4. 批量向量化
 *
 * @module @myopenclaw/server/memory
 */

import { createLogger } from '../core/utils/logger.js';
import type { EmbeddingServiceConfig } from './types.js';

const log = createLogger('memory:embedding');

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** 默认缓存大小 */
const DEFAULT_CACHE_SIZE = 1000;

/** 默认 OpenAI 兼容 API 地址 */
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** 默认模型名 */
const DEFAULT_MODEL = 'text-embedding-3-small';

/** 默认维度 */
const DEFAULT_DIMENSIONS = 1536;

// ═══════════════════════════════════════════════════════════════
// 简单 LRU 缓存
// ═══════════════════════════════════════════════════════════════

class LRUCache<K, V> {
  private map = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    // 移到末尾（最近使用）
    const value = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      // 删除最久未使用的（第一个）
      const firstKey = this.map.keys().next().value as K;
      this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }

  get size(): number {
    return this.map.size;
  }
}

// ═══════════════════════════════════════════════════════════════
// EmbeddingService 核心类
// ═══════════════════════════════════════════════════════════════

export class EmbeddingService {
  /** 提供商 */
  readonly provider: EmbeddingServiceConfig['provider'];

  /** 是否可用（能调用真实 API） */
  readonly available: boolean;

  private apiKey?: string;
  private baseUrl: string;
  private model: string;
  private dimensions: number;
  private batchSize: number;

  /** 向量缓存 */
  private cache = new LRUCache<string, number[]>(DEFAULT_CACHE_SIZE);

  constructor(config: EmbeddingServiceConfig = { provider: 'local' }) {
    this.provider = config.provider ?? 'local';
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_OPENAI_BASE_URL;
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.batchSize = config.batchSize ?? 64;
    this.available = this.provider !== 'local' && !!this.apiKey;

    if (this.available) {
      log.info({ provider: this.provider, model: this.model, dimensions: this.dimensions },
        'Embedding 服务已就绪');
    } else {
      log.info({ provider: this.provider },
        'Embedding 服务使用关键词回退模式（无 API 配置）');
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 公共方法
  // ═════════════════════════════════════════════════════════════

  /**
   * 计算单条文本的嵌入向量
   *
   * @param text 输入文本
   * @returns 向量数组
   */
  async computeEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      return new Array(this.dimensions).fill(0);
    }

    // 检查缓存
    const cacheKey = this.hashText(text);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    let embedding: number[];
    if (this.available) {
      embedding = await this.callEmbeddingAPI(text);
    } else {
      embedding = this.keywordEmbedding(text);
    }

    // 归一化（余弦相似度需要）
    embedding = this.normalize(embedding);

    // 缓存
    this.cache.set(cacheKey, embedding);

    return embedding;
  }

  /**
   * 批量计算嵌入向量
   *
   * @param texts 文本列表
   * @returns 向量数组列表
   */
  async computeBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    // 分批次处理
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      let batchEmbeddings: number[][];

      if (this.available) {
        batchEmbeddings = await this.callBatchEmbeddingAPI(batch);
      } else {
        batchEmbeddings = batch.map((t) => this.keywordEmbedding(t));
      }

      // 归一化并缓存
      for (let j = 0; j < batch.length; j++) {
        const emb = this.normalize(batchEmbeddings[j]);
        this.cache.set(this.hashText(batch[j]), emb);
        results.push(emb);
      }
    }

    return results;
  }

  /**
   * 获取向量维度
   */
  getDimension(): number {
    return this.dimensions;
  }

  // ═════════════════════════════════════════════════════════════
  // API 调用
  // ═════════════════════════════════════════════════════════════

  /**
   * 调用 OpenAI 兼容 Embedding API
   */
  private async callEmbeddingAPI(text: string): Promise<number[]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/embeddings`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
          dimensions: this.dimensions,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Embedding API 返回 ${response.status}: ${errorBody.slice(0, 200)}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[] }>;
      };

      if (!data?.data?.[0]?.embedding) {
        throw new Error('Embedding API 返回数据格式异常');
      }

      return data.data[0].embedding;
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'Embedding API 调用失败，回退到关键词模式');
      return this.keywordEmbedding(text);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 批量调用 Embedding API
   */
  private async callBatchEmbeddingAPI(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/embeddings`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
          dimensions: this.dimensions,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`Embedding API 返回 ${response.status}: ${errorBody.slice(0, 200)}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[]; index: number }>;
      };

      // 按 index 排序确保顺序一致
      const sorted = [...data.data].sort((a, b) => a.index - b.index);
      return sorted.map((item) => item.embedding);
    } catch (err) {
      log.warn({ err: (err as Error).message }, '批量 Embedding API 调用失败，回退到关键词模式');
      return texts.map((t) => this.keywordEmbedding(t));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 关键词回退模式
  // ═════════════════════════════════════════════════════════════

  /**
   * 基于 TF-IDF 思想的关键词向量化
   *
   * 策略：
   * 1. 提取中文/英文单词
   * 2. 用词频构建稀疏向量
   * 3. 压缩到目标维度
   *
   * 注意：这不是真正的语义向量，但在没有 Embedding API 时
   * 可以提供基本的关键词匹配能力。
   */
  private keywordEmbedding(text: string): number[] {
    const tokens = this.tokenize(text);
    if (tokens.length === 0) {
      return new Array(this.dimensions).fill(0);
    }

    // 初始化向量
    const vector = new Array(this.dimensions).fill(0);

    // 用简单哈希将每个 token 映射到向量维度
    for (const token of tokens) {
      const hash = this.stringHash(token);
      // 将哈希值分散到向量的多个位置
      for (let i = 0; i < 4; i++) {
        const idx = ((hash + i * 2654435761) >>> 0) % this.dimensions;
        vector[idx] += 1;
      }
    }

    return vector;
  }

  /**
   * 简单分词
   */
  private tokenize(text: string): string[] {
    // 提取中文字符、英文单词、数字
    const tokens: string[] = [];

    // 中文：连续中文字符
    const chineseMatches = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]{1,4}/g);
    if (chineseMatches) {
      tokens.push(...chineseMatches);
    }

    // 英文单词
    const wordMatches = text.match(/[a-zA-Z]{2,}/g);
    if (wordMatches) {
      tokens.push(...wordMatches.map((w) => w.toLowerCase()));
    }

    // 数字
    const numMatches = text.match(/\d+/g);
    if (numMatches) {
      tokens.push(...numMatches);
    }

    return tokens;
  }

  /**
   * 简单字符串哈希（djb2 算法变体）
   */
  private stringHash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return hash >>> 0;
  }

  // ═════════════════════════════════════════════════════════════
  // 工具方法
  // ═════════════════════════════════════════════════════════════

  /**
   * 向量 L2 归一化
   */
  private normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return vector;
    return vector.map((v) => v / norm);
  }

  /**
   * 文本哈希（用于缓存键）
   */
  private hashText(text: string): string {
    return `emb:${this.stringHash(text).toString(36)}:${text.length}`;
  }
}
