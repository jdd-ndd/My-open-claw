/**
 * 审计日志模块
 *
 * 全链路记录系统操作日志，同时写入内存存储和文件（JSON Lines）。
 *
 * @module @myopenclaw/server/gateway/audit
 */

import { EventEmitter } from 'node:events';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createLogger } from '../../core/utils/logger.js';
import type { MemoryStorage } from '../storage.js';
import type { AuditLogEntry, AuditLogQuery } from './types.js';

const log = createLogger('gateway:audit');

export class AuditLogger extends EventEmitter {
  private buffer: AuditLogEntry[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private storage: MemoryStorage,
    private logFilePath: string,
  ) {
    super();
    this.initStorage();
    this.initFileStream();
  }

  /** 初始化存储表 */
  private initStorage(): void {
    this.storage.ensureTable('audit_logs', `
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      event TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      channel_id TEXT,
      user_id TEXT,
      agent_id TEXT,
      session_id TEXT,
      task_id TEXT,
      details TEXT,
      source_ip TEXT,
      duration INTEGER,
      success INTEGER NOT NULL,
      error TEXT
    `);
  }

  /** 初始化文件流 */
  private initFileStream(): void {
    const dir = dirname(this.logFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => log.error('批量写入失败: %s', err));
    }, 5000);
  }

  /** 记录审计日志 */
  logEntry(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void {
    const fullEntry: AuditLogEntry = {
      ...entry,
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: Date.now(),
    };

    // 实时写入文件（JSON Lines）
    try {
      appendFileSync(this.logFilePath, JSON.stringify(fullEntry) + '\n');
    } catch {
      log.error('审计日志文件写入失败');
    }

    // 添加到缓冲区
    this.buffer.push(fullEntry);
    this.emit('log', fullEntry);

    // 超过 100 条立即刷写
    if (this.buffer.length >= 100) {
      this.flush().catch((err) => log.error('批量写入失败: %s', err));
    }
  }

  /** 批量写入存储 */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const entries = [...this.buffer];
    this.buffer = [];

    for (const entry of entries) {
      this.storage.prepare(
        `INSERT INTO audit_logs (id,category,event,timestamp,channel_id,user_id,agent_id,session_id,task_id,details,source_ip,duration,success,error)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        entry.id, entry.category, entry.event, entry.timestamp,
        entry.channelId ?? null, entry.userId ?? null, entry.agentId ?? null,
        entry.sessionId ?? null, entry.taskId ?? null,
        JSON.stringify(entry.details), entry.sourceIp ?? null,
        entry.duration ?? null, entry.success ? 1 : 0, entry.error ?? null,
      );
    }
  }

  /** 查询审计日志 */
  query(q: AuditLogQuery): AuditLogEntry[] {
    const allLogs = this.buffer.slice().reverse();
    let results = allLogs.filter((entry) => {
      if (q.category && entry.category !== q.category) return false;
      if (q.event && entry.event !== q.event) return false;
      if (q.startTime && entry.timestamp < q.startTime) return false;
      if (q.endTime && entry.timestamp > q.endTime) return false;
      if (q.channelId && entry.channelId !== q.channelId) return false;
      if (q.agentId && entry.agentId !== q.agentId) return false;
      if (q.success !== undefined && entry.success !== q.success) return false;
      return true;
    });

    if (q.offset) results = results.slice(q.offset);
    if (q.limit) results = results.slice(0, q.limit);
    return results;
  }

  /** 便捷方法：记录消息审计 */
  logMessage(params: { channelId?: string; userId?: string; agentId?: string; sessionId?: string; event: string; details?: Record<string, unknown>; success: boolean; error?: string }): void {
    this.logEntry({
      category: 'message',
      event: params.event,
      channelId: params.channelId,
      userId: params.userId,
      agentId: params.agentId,
      sessionId: params.sessionId,
      details: params.details ?? {},
      success: params.success,
      error: params.error,
    });
  }

  /** 便捷方法：记录安全审计 */
  logSecurity(params: { event: string; details?: Record<string, unknown>; success: boolean; error?: string }): void {
    this.logEntry({
      category: 'security',
      event: params.event,
      details: params.details ?? {},
      success: params.success,
      error: params.error,
    });
  }

  /** 便捷方法：记录工具调用审计 */
  logTool(params: { toolName: string; args?: Record<string, unknown>; result?: unknown; duration?: number; sessionId?: string; success: boolean; error?: string }): void {
    this.logEntry({
      category: 'tool',
      event: `tool.${params.success ? 'success' : 'error'}`,
      sessionId: params.sessionId,
      details: { toolName: params.toolName, args: params.args, result: params.result },
      duration: params.duration,
      success: params.success,
      error: params.error,
    });
  }

  /** 关闭审计日志模块 */
  async close(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
  }
}
