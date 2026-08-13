/**
 * Memory 管理 API (v1.1.7+)
 *
 * 包装 v1.1.6 暴露的 5 个 /api/memory/* 端点, 给前端 Memory 视图调用。
 * 全部走 httpClient (baseURL='/api') 所以路径省略 /api 前缀。
 *
 * @module web/api
 */
import { httpClient } from './http';

/* ═══════════════════════════════════════════════════════════════
 * 类型定义 (跟 server 端 MemoryManager 响应形状对齐)
 * ═══════════════════════════════════════════════════════════════ */

export interface MemorySession {
  sessionId: string;
  userId: string;
  channelId: string;
  agentId: string;
  metadata: {
    createdAt: number;
    lastActiveAt: number;
    messageCount: number;
    compressed: boolean;
  };
  taskState?: Record<string, unknown> | null;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
  }>;
}

export interface MemorySessionSummary {
  sessionId: string;
  userId: string;
  channelId: string;
  agentId: string;
  messageCount: number;
  createdAt: number;
  lastActiveAt: number;
}

export interface MemorySessionsResponse {
  total: number;
  activeCount: number;
  sessions: MemorySessionSummary[];
}

export interface MemoryVectorEntry {
  id: string;
  content: string;
  score?: number;
  dimension?: number;
  metadata: {
    sessionId?: string;
    userId?: string;
    type?: 'conversation' | 'task' | 'knowledge';
    importance?: number;
    tags?: string[];
    createdAt?: number;
    [k: string]: unknown;
  };
}

export interface MemoryVectorSearchResponse {
  query: string;
  total: number;
  results: MemoryVectorEntry[];
}

export interface MemoryStats {
  sessions: { active: number };
  vectors: { total: number };
  embedding: {
    provider: string;
    available: boolean;
    dimension: number;
  };
}

export interface MemoryStatsResponse extends MemoryStats {}

/* ═══════════════════════════════════════════════════════════════
 * Fetch 包装
 * ═══════════════════════════════════════════════════════════════ */

export async function fetchMemorySessions(): Promise<MemorySessionsResponse> {
  return httpClient.get('/memory/sessions') as Promise<MemorySessionsResponse>;
}

export async function fetchMemorySession(id: string): Promise<MemorySession> {
  return httpClient.get(`/memory/sessions/${encodeURIComponent(id)}`) as Promise<MemorySession>;
}

export async function deleteMemorySession(id: string): Promise<{ deleted: string }> {
  return httpClient.delete(`/memory/sessions/${encodeURIComponent(id)}`) as Promise<{ deleted: string }>;
}

export async function searchMemoryVectors(opts: {
  q: string;
  topK?: number;
  threshold?: number;
  sessionId?: string;
  type?: 'conversation' | 'task' | 'knowledge';
}): Promise<MemoryVectorSearchResponse> {
  const params: Record<string, string | number> = { q: opts.q };
  if (opts.topK !== undefined) params.topK = opts.topK;
  if (opts.threshold !== undefined) params.threshold = opts.threshold;
  if (opts.sessionId) params.sessionId = opts.sessionId;
  if (opts.type) params.type = opts.type;
  return httpClient.get('/memory/vectors/search', { params }) as Promise<MemoryVectorSearchResponse>;
}

export async function deleteMemoryVector(id: string): Promise<{ deleted: string }> {
  return httpClient.delete(`/memory/vectors/${encodeURIComponent(id)}`) as Promise<{ deleted: string }>;
}

export async function fetchMemoryStats(): Promise<MemoryStatsResponse> {
  return httpClient.get('/memory/stats') as Promise<MemoryStatsResponse>;
}

/* ═══════════════════════════════════════════════════════════════
 * Compat aliases (v1.1.0-era API 名字)
 *
 * 老的 MemoryInspector 等组件还在用旧名字 (getMemorySession / MemorySessionDetail),
 * 保持向后兼容, 不破坏既有 Settings UI. 新代码请用上面 fetch* / delete* / search* 命名.
 * ═══════════════════════════════════════════════════════════════ */

/** @deprecated Use fetchMemorySession instead */
export type MemorySessionDetail = MemorySession;

/** @deprecated Use fetchMemorySession instead */
export async function getMemorySession(id: string): Promise<MemorySession> {
  return fetchMemorySession(id);
}
