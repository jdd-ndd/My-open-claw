/**
 * Memory 模块 — 公共类型定义
 *
 * 对齐文档 docs/07-Memory记忆模块.md §3 的接口设计。
 * 所有类型均带中文注释，供 Session/Vector/Persist/Manager 共用。
 *
 * @module @myopenclaw/server/memory
 */

// ═══════════════════════════════════════════════════════════════
// 会话记忆相关类型
// ═══════════════════════════════════════════════════════════════

/** 会话消息（精简版，区别于全局 Message 结构体） */
export interface SessionMessage {
  /** 消息唯一 ID */
  id: string;
  /** 消息角色 */
  role: 'user' | 'assistant' | 'tool' | 'system';
  /** 消息文本内容 */
  content: string;
  /** 生成时间戳（Unix 毫秒） */
  timestamp: number;
  /** 附件引用列表 */
  attachments?: Array<{
    id: string;
    type: 'image' | 'audio' | 'video' | 'file';
    url?: string;
    mimeType: string;
    filename?: string;
  }>;
  /** 工具调用信息（role === 'tool' 时填充） */
  toolCall?: {
    name: string;
    params: Record<string, unknown>;
    callId: string;
  };
  /** 该消息是否已被压缩（被摘要替代） */
  compressed?: boolean;
}

/** 会话数据结构 */
export interface SessionData {
  /** 会话唯一 ID */
  sessionId: string;
  /** 用户 ID */
  userId: string;
  /** 渠道 ID */
  channelId: string;
  /** 绑定的 Agent ID */
  agentId: string;
  /** 消息历史列表（按时间顺序） */
  messages: SessionMessage[];
  /** 任务中间状态 */
  taskState?: Record<string, unknown>;
  /** 会话元数据 */
  metadata: {
    /** 创建时间（Unix 毫秒） */
    createdAt: number;
    /** 最后活跃时间（Unix 毫秒） */
    lastActiveAt: number;
    /** 消息总数 */
    messageCount: number;
    /** 是否已压缩 */
    compressed: boolean;
  };
}

/** 会话配置 */
export interface SessionConfig {
  /** 用户 ID */
  userId: string;
  /** 渠道 ID */
  channelId: string;
  /** 绑定的 Agent ID */
  agentId: string;
  /** 会话 TTL（秒），超时后可被清理，默认 86400（24小时） */
  ttlSeconds?: number;
}

/** 会话过滤条件 */
export interface SessionFilter {
  /** 按用户 ID 过滤 */
  userId?: string;
  /** 按渠道 ID 过滤 */
  channelId?: string;
  /** 仅返回此时间之后活跃的会话（Unix 毫秒） */
  activeAfter?: number;
}

/** 会话摘要（轻量列表用） */
export interface SessionSummary {
  sessionId: string;
  userId: string;
  channelId: string;
  agentId: string;
  messageCount: number;
  createdAt: number;
  lastActiveAt: number;
}

/** 会话压缩选项 */
export interface SessionCompressOptions {
  /** 保留最近 N 条消息不压缩，默认 20 */
  keepRecent?: number;
  /** 每批合并的消息数，默认 10 */
  batchSize?: number;
  /** 自定义摘要生成函数 */
  summarize?: (messages: SessionMessage[]) => Promise<string>;
}

// ═══════════════════════════════════════════════════════════════
// 向量记忆相关类型
// ═══════════════════════════════════════════════════════════════

/** 记忆类型 */
export type MemoryType = 'conversation' | 'task' | 'knowledge';

/** 向量记忆元数据 */
export interface VectorMetadata {
  /** 来源会话 ID */
  sessionId: string;
  /** 用户 ID */
  userId: string;
  /** 记忆类型 */
  type: MemoryType;
  /** 关键词标签 */
  tags?: string[];
  /** 重要性分数（0-1，默认 0.5） */
  importance?: number;
  /** 创建时间（Unix 毫秒） */
  createdAt?: number;
  /** 自定义元数据 */
  custom?: Record<string, unknown>;
}

/** 向量记忆条目 */
export interface VectorMemoryEntry {
  /** 记忆唯一 ID */
  id: string;
  /** 原始文本内容 */
  content: string;
  /** 向量数据 */
  embedding: number[];
  /** 向量维度 */
  dimension: number;
  /** 元数据 */
  metadata: VectorMetadata;
  /** 相似度分数（检索时填充，0-1） */
  score?: number;
}

/** 向量存储输入 */
export interface VectorStoreInput {
  /** 文本内容 */
  content: string;
  /** 元数据 */
  metadata: VectorMetadata;
  /** 预计算的向量（不填则由 EmbeddingService 自动生成） */
  embedding?: number[];
}

/** 向量检索选项 */
export interface VectorSearchOptions {
  /** 返回最相关的 K 条记忆，默认 5 */
  topK?: number;
  /** 相似度阈值（0-1），低于此值的记忆不返回，默认 0 */
  threshold?: number;
  /** 限定会话范围 */
  sessionId?: string;
  /** 限定用户范围 */
  userId?: string;
  /** 限定记忆类型 */
  type?: MemoryType;
  /** 时间范围过滤（Unix 毫秒） */
  timeRange?: { start?: number; end?: number };
  /** 标签过滤 */
  tags?: string[];
  /** 相似度算法 */
  similarity?: 'cosine' | 'euclidean' | 'dotProduct';
}

/** 向量更新输入 */
export interface VectorUpdateInput {
  /** 新的文本内容（更新后自动重新向量化） */
  content?: string;
  /** 更新的元数据（部分更新） */
  metadata?: Partial<VectorMetadata>;
}

/** 向量删除过滤条件 */
export interface VectorDeleteFilter {
  sessionId?: string;
  userId?: string;
  timeRange?: { start?: number; end?: number };
  type?: MemoryType;
}

/** 向量计数过滤条件 */
export interface VectorCountFilter {
  sessionId?: string;
  userId?: string;
  type?: MemoryType;
}

// ═══════════════════════════════════════════════════════════════
// 持久化层相关类型
// ═══════════════════════════════════════════════════════════════

/** 持久化写入选项 */
export interface PersistWriteOptions {
  /** 是否同步写入（等待 fsync），默认 false */
  sync?: boolean;
  /** TTL 过期时间（毫秒），暂不实现自动过期 */
  ttl?: number;
  /** 是否使用 gzip 压缩，默认 false */
  compress?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// Embedding 服务类型
// ═══════════════════════════════════════════════════════════════

/** Embedding 服务配置 */
export interface EmbeddingServiceConfig {
  /** 提供商 */
  provider: 'openai' | 'cohere' | 'local';
  /** API 密钥 */
  apiKey?: string;
  /** 自定义 API 地址 */
  baseUrl?: string;
  /** 模型名称 */
  model?: string;
  /** 向量维度 */
  dimensions?: number;
  /** 批量处理大小 */
  batchSize?: number;
}

// ═══════════════════════════════════════════════════════════════
// MemoryManager 门面类型
// ═══════════════════════════════════════════════════════════════

/** 记忆写入选项 */
export interface RememberOptions {
  /** 是否同时存入长期向量记忆，默认 false（仅会话） */
  storeVector?: boolean;
  /** 记忆类型 */
  type?: MemoryType;
  /** 重要性分数（0-1） */
  importance?: number;
  /** 关键词标签 */
  tags?: string[];
}

/** 记忆检索结果 */
export interface RecallResult {
  /** 会话上下文 */
  session: SessionData | null;
  /** 匹配的长期记忆列表 */
  vectors: VectorMemoryEntry[];
}
