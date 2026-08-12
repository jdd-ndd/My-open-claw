/**
 * SessionMemory — 短期会话记忆
 *
 * 对齐文档 docs/07-Memory记忆模块.md §2.1
 *
 * 职责：
 *   - 管理单会话的消息历史和任务中间状态
 *   - 会话隔离（按 sessionId）
 *   - 消息追加与上下文压缩
 *   - TTL 过期自动清理
 *   - 持久化到 PersistLayer
 *
 * @module @myopenclaw/server/memory
 */

import { createLogger } from '../core/utils/logger.js';
import { generateId } from '../core/utils/id.js';
import type { PersistLayer } from './persist.js';
import type {
  SessionData,
  SessionMessage,
  SessionConfig,
  SessionFilter,
  SessionSummary,
  SessionCompressOptions,
} from './types.js';

const log = createLogger('memory:session');

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** 持久化键前缀 */
const SESSION_KEY_PREFIX = 'sessions';

/** 默认最大消息数（触发压缩阈值） */
const DEFAULT_MAX_MESSAGES = 50;

/** 默认 TTL（秒） */
const DEFAULT_TTL_SECONDS = 86400; // 24 小时

/** 默认压缩保留最近消息数 */
const DEFAULT_KEEP_RECENT = 20;

/** 默认压缩批大小 */
const DEFAULT_BATCH_SIZE = 10;

// ═══════════════════════════════════════════════════════════════
// SessionMemory 核心类
// ═══════════════════════════════════════════════════════════════

export class SessionMemory {
  /** 内存缓存（活跃会话） */
  private cache = new Map<string, SessionData>();

  /** 持久化层（可选） */
  private persist?: PersistLayer;

  /** 最大消息数（触发压缩） */
  private maxMessages: number;

  /** 会话 TTL（秒） */
  private ttlSeconds: number;

  /** 是否已初始化 */
  private loaded = false;

  constructor(
    persist?: PersistLayer,
    options?: { maxMessages?: number; ttlSeconds?: number },
  ) {
    this.persist = persist;
    this.maxMessages = options?.maxMessages ?? DEFAULT_MAX_MESSAGES;
    this.ttlSeconds = options?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  // ═════════════════════════════════════════════════════════════
  // 生命周期
  // ═════════════════════════════════════════════════════════════

  /**
   * 从持久化加载所有会话
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    if (!this.persist) {
      this.loaded = true;
      return;
    }

    try {
      const sessions = await this.persist.readByPrefix<SessionData>(SESSION_KEY_PREFIX);
      let count = 0;
      for (const { value: data } of sessions) {
        if (data?.sessionId) {
          this.cache.set(data.sessionId, data);
          count++;
        }
      }
      log.info({ count }, '会话数据已从持久化加载');
    } catch (err) {
      log.warn({ err: (err as Error).message }, '会话数据加载失败，使用空缓存');
    }

    this.loaded = true;
  }

  /**
   * 持久化单个会话
   */
  private async saveSession(sessionId: string): Promise<void> {
    if (!this.persist) return;
    const data = this.cache.get(sessionId);
    if (!data) return;

    const key = `${SESSION_KEY_PREFIX}/${sessionId}`;
    try {
      await this.persist.write(key, data);
    } catch (err) {
      log.warn({ sessionId, err: (err as Error).message }, '会话持久化失败');
    }
  }

  /**
   * 删除持久化的会话文件
   */
  private async deleteSessionFile(sessionId: string): Promise<void> {
    if (!this.persist) return;
    const key = `${SESSION_KEY_PREFIX}/${sessionId}`;
    try {
      await this.persist.delete(key);
    } catch (err) {
      log.warn({ sessionId, err: (err as Error).message }, '会话文件删除失败');
    }
  }

  // ═════════════════════════════════════════════════════════════
  // 会话管理
  // ═════════════════════════════════════════════════════════════

  /**
   * 创建新会话
   *
   * @param sessionId 会话 ID
   * @param config 会话配置
   * @returns 创建的会话数据
   */
  async create(sessionId: string, config: SessionConfig): Promise<SessionData> {
    if (this.cache.has(sessionId)) {
      log.warn({ sessionId }, '会话已存在，返回已有数据');
      return this.cache.get(sessionId)!;
    }

    const now = Date.now();
    const session: SessionData = {
      sessionId,
      userId: config.userId,
      channelId: config.channelId,
      agentId: config.agentId,
      messages: [],
      metadata: {
        createdAt: now,
        lastActiveAt: now,
        messageCount: 0,
        compressed: false,
      },
    };

    this.cache.set(sessionId, session);
    await this.saveSession(sessionId);

    log.info({ sessionId, userId: config.userId }, '会话已创建');
    return session;
  }

  /**
   * 读取会话数据
   *
   * @param sessionId 会话 ID
   * @returns 会话数据，不存在返回 null
   */
  async read(sessionId: string): Promise<SessionData | null> {
    // 先从内存缓存读取
    if (this.cache.has(sessionId)) {
      return this.cache.get(sessionId)!;
    }

    // 尝试从持久化加载
    if (this.persist) {
      const key = `${SESSION_KEY_PREFIX}/${sessionId}`;
      const data = await this.persist.read<SessionData>(key);
      if (data) {
        this.cache.set(sessionId, data);
        return data;
      }
    }

    return null;
  }

  /**
   * 追加消息到会话
   *
   * @param sessionId 会话 ID
   * @param message 待追加的消息
   * @returns 更新后的消息总数
   */
  async append(sessionId: string, message: SessionMessage): Promise<number> {
    let session = this.cache.get(sessionId);

    // 如果不存在则自动创建（兼容旧代码直接 append 的场景）
    if (!session) {
      session = {
        sessionId,
        userId: 'unknown',
        channelId: 'unknown',
        agentId: 'default',
        messages: [],
        metadata: {
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          messageCount: 0,
          compressed: false,
        },
      };
      this.cache.set(sessionId, session);
    }

    // 追加消息
    session.messages.push(message);
    session.metadata.lastActiveAt = Date.now();
    session.metadata.messageCount = session.messages.length;

    // 检查是否需要压缩
    if (session.messages.length > this.maxMessages) {
      try {
        await this.compress(sessionId, {
          keepRecent: DEFAULT_KEEP_RECENT,
          batchSize: DEFAULT_BATCH_SIZE,
        });
        // 重新读取压缩后的数据
        const compressed = this.cache.get(sessionId);
        if (compressed) {
          session = compressed;
        }
      } catch (err) {
        log.warn({ sessionId, err: (err as Error).message }, '自动压缩失败');
      }
    }

    // 持久化
    await this.saveSession(sessionId);

    log.debug({ sessionId, messageCount: session.metadata.messageCount }, '会话消息已追加');
    return session.metadata.messageCount;
  }

  /**
   * 更新已有会话的基础元数据。
   *
   * 用于修正先 append 再补建会话时遗留的 unknown user/channel 信息。
   */
  async updateSessionContext(
    sessionId: string,
    context: Partial<Pick<SessionData, 'userId' | 'channelId' | 'agentId'>>,
  ): Promise<SessionData | null> {
    const session = await this.read(sessionId);
    if (!session) {
      return null;
    }

    const nextUserId = context.userId?.trim();
    const nextChannelId = context.channelId?.trim();
    const nextAgentId = context.agentId?.trim();

    if (nextUserId) session.userId = nextUserId;
    if (nextChannelId) session.channelId = nextChannelId;
    if (nextAgentId) session.agentId = nextAgentId;

    session.metadata.lastActiveAt = Date.now();
    await this.saveSession(sessionId);
    return session;
  }

  // ═════════════════════════════════════════════════════════════
  // 任务状态
  // ═════════════════════════════════════════════════════════════

  /**
   * 更新任务中间状态
   *
   * @param sessionId 会话 ID
   * @param state 任务状态数据
   */
  async updateTaskState(sessionId: string, state: Record<string, unknown>): Promise<void> {
    const session = this.cache.get(sessionId);
    if (!session) {
      log.warn({ sessionId }, '会话不存在，无法更新任务状态');
      return;
    }

    session.taskState = { ...(session.taskState ?? {}), ...state };
    session.metadata.lastActiveAt = Date.now();
    await this.saveSession(sessionId);
  }

  /**
   * 读取任务中间状态
   *
   * @param sessionId 会话 ID
   * @returns 任务状态数据
   */
  async getTaskState(sessionId: string): Promise<Record<string, unknown> | null> {
    const session = this.cache.get(sessionId);
    return session?.taskState ?? null;
  }

  // ═════════════════════════════════════════════════════════════
  // 压缩
  // ═════════════════════════════════════════════════════════════

  /**
   * 压缩会话历史
   *
   * 将较早的消息合并为摘要，减少上下文长度。
   *
   * @param sessionId 会话 ID
   * @param options 压缩选项
   * @returns 压缩前后的消息数
   */
  async compress(
    sessionId: string,
    options: SessionCompressOptions = {},
  ): Promise<{ before: number; after: number }> {
    const session = this.cache.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    const keepRecent = options.keepRecent ?? DEFAULT_KEEP_RECENT;
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;

    const messages = session.messages;
    if (messages.length <= keepRecent) {
      return { before: messages.length, after: messages.length };
    }

    // 将需要压缩的消息分批次合并
    const messagesToCompress = messages.slice(0, messages.length - keepRecent);
    const recentMessages = messages.slice(messages.length - keepRecent);

    const summaryFn = options.summarize ?? this.defaultSummarize.bind(this);
    const summarized: SessionMessage[] = [];

    for (let i = 0; i < messagesToCompress.length; i += batchSize) {
      const batch = messagesToCompress.slice(i, i + batchSize);
      const summary = await summaryFn(batch);

      summarized.push({
        id: generateId(),
        role: 'system',
        content: summary,
        timestamp: batch[batch.length - 1].timestamp,
        compressed: true,
      });
    }

    // 构建新的消息列表：压缩摘要 + 最近消息
    session.messages = [...summarized, ...recentMessages];
    session.metadata.messageCount = session.messages.length;
    session.metadata.compressed = true;
    session.metadata.lastActiveAt = Date.now();

    await this.saveSession(sessionId);

    log.info({
      sessionId,
      before: messages.length,
      after: session.messages.length,
      batches: summarized.length,
    }, '会话历史已压缩');

    return { before: messages.length, after: session.messages.length };
  }

  // ═════════════════════════════════════════════════════════════
  // 删除与清理
  // ═════════════════════════════════════════════════════════════

  /**
   * 删除会话（包括内存和持久化数据）
   *
   * @param sessionId 会话 ID
   */
  async delete(sessionId: string): Promise<void> {
    this.cache.delete(sessionId);
    await this.deleteSessionFile(sessionId);
    log.info({ sessionId }, '会话已删除');
  }

  /**
   * 清理过期会话
   *
   * @returns 清理的会话数量
   */
  async cleanupExpired(): Promise<number> {
    const now = Date.now();
    const ttlMs = this.ttlSeconds * 1000;
    const expiredIds: string[] = [];

    for (const [id, session] of this.cache) {
      if (now - session.metadata.lastActiveAt > ttlMs) {
        expiredIds.push(id);
      }
    }

    for (const id of expiredIds) {
      this.cache.delete(id);
      await this.deleteSessionFile(id);
    }

    if (expiredIds.length > 0) {
      log.info({ count: expiredIds.length, ttlSeconds: this.ttlSeconds }, '过期会话已清理');
    }

    return expiredIds.length;
  }

  /**
   * 获取会话列表
   *
   * @param filter 过滤条件
   * @returns 会话摘要列表
   */
  async list(filter?: SessionFilter): Promise<SessionSummary[]> {
    const summaries: SessionSummary[] = [];

    for (const session of this.cache.values()) {
      // 应用过滤条件
      if (filter?.userId && session.userId !== filter.userId) continue;
      if (filter?.channelId && session.channelId !== filter.channelId) continue;
      if (filter?.activeAfter && session.metadata.lastActiveAt < filter.activeAfter) continue;

      summaries.push({
        sessionId: session.sessionId,
        userId: session.userId,
        channelId: session.channelId,
        agentId: session.agentId,
        messageCount: session.metadata.messageCount,
        createdAt: session.metadata.createdAt,
        lastActiveAt: session.metadata.lastActiveAt,
      });
    }

    // 按最后活跃时间降序
    summaries.sort((a, b) => b.lastActiveAt - a.lastActiveAt);

    return summaries;
  }

  /**
   * 获取活跃会话数
   */
  get activeCount(): number {
    return this.cache.size;
  }

  // ═════════════════════════════════════════════════════════════
  // 工具方法
  // ═════════════════════════════════════════════════════════════

  /**
   * 默认摘要生成（不依赖 LLM）
   *
   * 从一批消息中提取关键词和角色信息，生成简短摘要。
   */
  private defaultSummarize(messages: SessionMessage[]): string {
    const roles: Record<string, number> = {};
    const keywords: string[] = [];

    for (const msg of messages) {
      roles[msg.role] = (roles[msg.role] ?? 0) + 1;

      // 提取长度 > 5 的文本片段作为关键词
      const content = msg.content.slice(0, 100);
      if (content.length > 5) {
        keywords.push(content);
      }
    }

    const roleSummary = Object.entries(roles)
      .map(([role, count]) => `${role} ×${count}`)
      .join(', ');

    const preview = keywords.length > 0
      ? keywords.slice(0, 3).map((k) => `"${k.slice(0, 30)}"`).join('; ')
      : '(无文本内容)';

    return `[历史摘要] ${roleSummary} | 内容: ${preview}`;
  }
}
