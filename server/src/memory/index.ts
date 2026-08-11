/**
 * Memory — 记忆模块聚合导出
 *
 * 对齐文档 docs/07-Memory记忆模块.md
 *
 * 三层架构：
 *   1. SessionMemory — 短期会话记忆（多轮对话上下文）
 *   2. VectorMemory  — 长期向量记忆（跨会话语义检索）
 *   3. PersistLayer  — 数据持久化层（本地文件存储）
 *
 * 门面入口：
 *   MemoryManager — 统一管理入口，提供 remember/recall 快捷方法
 *
 * @module @myopenclaw/server/memory
 */

export { SessionMemory } from './session.js';
export { VectorMemory } from './vector.js';
export { EmbeddingService } from './embedding.js';
export { PersistLayer } from './persist.js';
export { MemoryManager } from './manager.js';
export type { MemoryManagerOptions } from './manager.js';

// 类型导出
export type {
  SessionMessage,
  SessionData,
  SessionConfig,
  SessionFilter,
  SessionSummary,
  SessionCompressOptions,
  VectorMemoryEntry,
  VectorStoreInput,
  VectorSearchOptions,
  VectorUpdateInput,
  VectorDeleteFilter,
  VectorCountFilter,
  VectorMetadata,
  MemoryType,
  PersistWriteOptions,
  EmbeddingServiceConfig,
  RememberOptions,
  RecallResult,
} from './types.js';
