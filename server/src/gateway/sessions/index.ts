import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../core/utils/logger.js';
import type { MemoryStorage, StorageRow } from '../core/storage.js';
import type { NormalizedMessage, Session } from './types.js';

const log = createLogger('gateway:session-manager');

export class SessionManager extends EventEmitter {
  private sessionCache = new Map<string, Session>();
  private storage: MemoryStorage;

  constructor(storage: MemoryStorage) {
    super();
    this.storage = storage;
  }

  initDatabase(): void {
    this.storage.ensureTable('sessions', `
      session_id   TEXT PRIMARY KEY,
      channel_id   TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      agent_id     TEXT NOT NULL,
      title        TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL,
      last_active  INTEGER NOT NULL,
      pinned_at    INTEGER,
      status       TEXT DEFAULT 'active',
      metadata     TEXT
    `);

    this.storage.ensureTable('messages', `
      message_id   TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL,
      channel_id   TEXT NOT NULL,
      content      TEXT NOT NULL,
      msg_type     TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      role         TEXT,
      source       TEXT,
      raw          TEXT,
      created_at   INTEGER NOT NULL
    `);

    log.info('Session storage tables initialized');
  }

  resolve(channelId: string, userId: string, agentId: string, preferredSessionId?: string): Session {
    if (preferredSessionId) {
      const preferred = this.findSessionById(preferredSessionId);
      if (preferred && preferred.status !== 'closed') {
        this.sessionCache.set(this.cacheKey(preferred.channelId, preferred.userId), preferred);
        return preferred;
      }
    }

    const cacheKey = this.cacheKey(channelId, userId);
    const cached = this.sessionCache.get(cacheKey);
    if (cached && cached.status !== 'closed') {
      log.debug({ sessionId: cached.sessionId }, 'Session cache hit');
      return cached;
    }

    const existing = this.findOpenSession(channelId, userId, preferredSessionId);
    if (existing) {
      this.sessionCache.set(cacheKey, existing);
      log.debug({ sessionId: existing.sessionId }, 'Session restored from storage');
      return existing;
    }

    const now = Date.now();
    const session: Session = {
      sessionId: preferredSessionId || `sess_${now}_${randomUUID().slice(0, 8)}`,
      channelId,
      userId,
      agentId,
      title: 'New Session',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      pinnedAt: null,
      status: 'active',
      messageIds: [],
      metadata: {},
    };

    this.storage
      .prepare(
        'INSERT INTO sessions (session_id, channel_id, user_id, agent_id, title, created_at, updated_at, last_active, pinned_at, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        session.sessionId,
        session.channelId,
        session.userId,
        session.agentId,
        session.title,
        session.createdAt,
        session.updatedAt,
        session.lastActiveAt,
        session.pinnedAt,
        session.status,
        JSON.stringify(session.metadata ?? {}),
      );

    this.sessionCache.set(cacheKey, session);
    log.info({ sessionId: session.sessionId, agentId, preferredSessionId }, 'Session created');
    this.emit('session:created', session);

    return session;
  }

  /**
   * 创建全新会话（不检查缓存，用于 REST API 会话创建）
   *
   * 与 resolve 不同，此方法总是生成新的 sessionId，
   * 不会返回同一 channelId + userId 下的已有会话。
   * 适用于用户主动"新建会话"的场景。
   */
  createNewSession(channelId: string, userId: string, agentId: string, title?: string): Session {
    const now = Date.now();
    const session: Session = {
      sessionId: `sess_${now}_${randomUUID().slice(0, 8)}`,
      channelId,
      userId,
      agentId,
      title: title?.trim() || 'New Session',
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
      pinnedAt: null,
      status: 'active',
      messageIds: [],
      metadata: {},
    };

    this.storage
      .prepare(
        'INSERT INTO sessions (session_id, channel_id, user_id, agent_id, title, created_at, updated_at, last_active, pinned_at, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        session.sessionId,
        session.channelId,
        session.userId,
        session.agentId,
        session.title,
        session.createdAt,
        session.updatedAt,
        session.lastActiveAt,
        session.pinnedAt,
        session.status,
        JSON.stringify(session.metadata ?? {}),
      );

    const cacheKey = this.cacheKey(channelId, userId);
    this.sessionCache.set(cacheKey, session);
    log.info({ sessionId: session.sessionId, agentId }, 'New session created (force)');
    this.emit('session:created', session);

    return session;
  }

  close(sessionId: string): void {
    for (const [key, session] of this.sessionCache) {
      if (session.sessionId === sessionId) {
        session.status = 'closed';
        this.sessionCache.delete(key);
        break;
      }
    }

    const row = this.storage.prepare('SELECT * FROM sessions').get(sessionId);
    if (row) {
      const now = Date.now();
      this.storage
        .prepare(
          'INSERT INTO sessions (session_id, channel_id, user_id, agent_id, title, created_at, updated_at, last_active, pinned_at, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          row.session_id,
          row.channel_id,
          row.user_id,
          row.agent_id,
          row.title ?? 'New Session',
          row.created_at,
          now,
          row.last_active,
          row.pinned_at ?? null,
          'closed',
          row.metadata ?? '{}',
        );
    }

    log.info({ sessionId }, 'Session closed');
    this.emit('session:closed', sessionId);
  }

  getHistory(sessionId: string, limit = 20): NormalizedMessage[] {
    const allMessages = this.storage.prepare('SELECT * FROM messages').all();

    const sessionMessages = allMessages
      .filter((row) => row.session_id === sessionId)
      .map((row) => this.rowToMessage(row));

    sessionMessages.sort((a, b) => b.timestamp - a.timestamp);
    const recent = sessionMessages.slice(0, limit);
    recent.reverse();

    return recent;
  }

  getHistoryPaginated(
    sessionId: string,
    options: { offset?: number; limit?: number } = {},
  ): { messages: NormalizedMessage[]; hasMore: boolean; total: number } {
    const { offset = 0, limit = 20 } = options;
    const allMessages = this.storage.prepare('SELECT * FROM messages').all();

    const sessionMessages = allMessages
      .filter((row) => row.session_id === sessionId)
      .map((row) => this.rowToMessage(row));

    sessionMessages.sort((a, b) => b.timestamp - a.timestamp);

    const total = sessionMessages.length;
    const sliced = sessionMessages.slice(offset, offset + limit);
    sliced.reverse();

    return {
      messages: sliced,
      hasMore: offset + sliced.length < total,
      total,
    };
  }

  persistMessage(session: Session, message: NormalizedMessage): void {
    const metadata = this.extractMessageMetadata(message.raw);
    this.storage
      .prepare(
        'INSERT INTO messages (message_id, session_id, channel_id, content, msg_type, user_id, role, source, raw, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        message.messageId,
        session.sessionId,
        message.channelId || session.channelId,
        message.content,
        message.messageType,
        message.userId,
        metadata.role,
        metadata.source,
        JSON.stringify(message.raw ?? {}),
        message.timestamp,
      );

    session.messageIds.push(message.messageId);
  }

  touch(sessionId: string): void {
    const now = Date.now();

    for (const [, session] of this.sessionCache) {
      if (session.sessionId === sessionId) {
        session.lastActiveAt = now;
        session.updatedAt = now;
        session.status = 'active';
        break;
      }
    }

    const row = this.storage.prepare('SELECT * FROM sessions').get(sessionId);
    if (row) {
      this.storage
        .prepare(
          'INSERT INTO sessions (session_id, channel_id, user_id, agent_id, title, created_at, updated_at, last_active, pinned_at, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          row.session_id,
          row.channel_id,
          row.user_id,
          row.agent_id,
          row.title ?? 'New Session',
          row.created_at,
          now,
          now,
          row.pinned_at ?? null,
          'active',
          row.metadata ?? '{}',
        );
    }
  }

  listSessions(filter?: { channelId?: string; userId?: string; includeClosed?: boolean }): Session[] {
    const allSessions = this.storage.prepare('SELECT * FROM sessions').all()
      .map((row) => this.rowToSession(row));

    return allSessions
      .filter((session) => {
        if (filter?.channelId && session.channelId !== filter.channelId) return false;
        if (filter?.userId && session.userId !== filter.userId) return false;
        if (!filter?.includeClosed && session.status === 'closed') return false;
        return true;
      })
      .sort((a, b) => {
        const aPinned = a.pinnedAt ?? 0;
        const bPinned = b.pinnedAt ?? 0;
        if (!!aPinned !== !!bPinned) return bPinned - aPinned;
        if (aPinned !== bPinned) return bPinned - aPinned;
        return b.updatedAt - a.updatedAt;
      });
  }

  getSession(sessionId: string): Session | null {
    return this.findSessionById(sessionId);
  }

  updateSession(sessionId: string, updates: { title?: string; pinnedAt?: number | null; status?: Session['status']; metadata?: Record<string, unknown> }): Session | null {
    const existing = this.findSessionById(sessionId);
    if (!existing) {
      return null;
    }

    const next: Session = {
      ...existing,
      ...(updates.title !== undefined ? { title: updates.title } : {}),
      ...(updates.pinnedAt !== undefined ? { pinnedAt: updates.pinnedAt } : {}),
      ...(updates.status !== undefined ? { status: updates.status } : {}),
      ...(updates.metadata !== undefined ? { metadata: updates.metadata } : {}),
      updatedAt: Date.now(),
    };

    this.storage
      .prepare(
        'INSERT INTO sessions (session_id, channel_id, user_id, agent_id, title, created_at, updated_at, last_active, pinned_at, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        next.sessionId,
        next.channelId,
        next.userId,
        next.agentId,
        next.title ?? 'New Session',
        next.createdAt,
        next.updatedAt,
        next.lastActiveAt,
        next.pinnedAt ?? null,
        next.status,
        JSON.stringify(next.metadata ?? {}),
      );

    this.sessionCache.set(this.cacheKey(next.channelId, next.userId), next);
    return next;
  }

  deleteSession(sessionId: string): boolean {
    const existing = this.findSessionById(sessionId);
    if (!existing) {
      return false;
    }

    this.storage.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);

    const allMessages = this.storage.prepare('SELECT * FROM messages').all();
    for (const row of allMessages) {
      if (String(row.session_id ?? '') === sessionId) {
        this.storage.prepare('DELETE FROM messages WHERE message_id = ?').run(row.message_id);
      }
    }

    this.sessionCache.delete(this.cacheKey(existing.channelId, existing.userId));
    return true;
  }

  get activeCount(): number {
    return this.sessionCache.size;
  }

  private cacheKey(channelId: string, userId: string): string {
    return `${channelId}:${userId}`;
  }

  private findOpenSession(channelId: string, userId: string, preferredSessionId?: string): Session | null {
    const allSessions = this.storage.prepare('SELECT * FROM sessions').all();

    if (preferredSessionId) {
      const exact = allSessions.find((row) => row.session_id === preferredSessionId && row.status !== 'closed');
      if (exact) {
        return this.rowToSession(exact);
      }
    }

    const existing = allSessions.find(
      (row) => row.channel_id === channelId && row.user_id === userId && row.status !== 'closed',
    );

    return existing ? this.rowToSession(existing) : null;
  }

  private findSessionById(sessionId: string): Session | null {
    for (const session of this.sessionCache.values()) {
      if (session.sessionId === sessionId) {
        return session;
      }
    }

    const row = this.storage.prepare('SELECT * FROM sessions').get(sessionId);
    return row ? this.rowToSession(row) : null;
  }

  private rowToSession(row: StorageRow): Session {
    return {
      sessionId: String(row.session_id ?? ''),
      channelId: String(row.channel_id ?? ''),
      userId: String(row.user_id ?? ''),
      agentId: String(row.agent_id ?? ''),
      title: String(row.title ?? 'New Session'),
      createdAt: Number(row.created_at ?? 0),
      updatedAt: Number(row.updated_at ?? row.last_active ?? row.created_at ?? 0),
      lastActiveAt: Number(row.last_active ?? 0),
      pinnedAt: row.pinned_at === null || row.pinned_at === undefined ? null : Number(row.pinned_at),
      status: (row.status as Session['status']) ?? 'active',
      messageIds: [],
      metadata: this.parseMetadata(row.metadata),
    };
  }

  private parseMetadata(raw: unknown): Record<string, unknown> {
    if (!raw) {
      return {};
    }
    if (typeof raw === 'object') {
      return raw as Record<string, unknown>;
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed ? parsed as Record<string, unknown> : {};
      } catch {
        return {};
      }
    }
    return {};
  }

  private rowToMessage(row: StorageRow): NormalizedMessage {
    const raw = this.parseMetadata(row.raw);
    const role = typeof row.role === 'string' ? row.role : undefined;
    const source = typeof row.source === 'string' ? row.source : undefined;

    if (role && raw.role === undefined) {
      raw.role = role;
    }

    if (source && raw.source === undefined) {
      raw.source = source;
    }

    if (raw.role === undefined || raw.source === undefined) {
      const inferred = this.inferLegacyMessageIdentity({
        channelId: String(row.channel_id ?? ''),
        userId: String(row.user_id ?? ''),
        raw,
      });
      if (raw.role === undefined) {
        raw.role = inferred.role;
      }
      if (raw.source === undefined) {
        raw.source = inferred.source;
      }
    }

    return {
      messageId: String(row.message_id ?? ''),
      sessionId: String(row.session_id ?? ''),
      channelId: String(row.channel_id ?? ''),
      userId: String(row.user_id ?? ''),
      content: String(row.content ?? ''),
      messageType: (row.msg_type as NormalizedMessage['messageType']) ?? 'text',
      raw,
      timestamp: Number(row.created_at ?? 0),
    };
  }

  private extractMessageMetadata(raw: unknown): { role: string | null; source: string | null } {
    if (!raw || typeof raw !== 'object') {
      return { role: null, source: null };
    }

    const candidate = raw as Record<string, unknown>;
    const role = typeof candidate.role === 'string' ? candidate.role : null;
    const source = typeof candidate.source === 'string' ? candidate.source : null;
    return { role, source };
  }

  private inferLegacyMessageIdentity(input: {
    channelId: string;
    userId: string;
    raw: Record<string, unknown>;
  }): { role: 'user' | 'assistant'; source: 'user' | 'assistant' } {
    const { userId, raw } = input;

    const rawRole = raw.role;
    if (rawRole === 'user' || rawRole === 'assistant') {
      return { role: rawRole, source: rawRole };
    }

    const rawSource = raw.source;
    if (rawSource === 'user' || rawSource === 'assistant') {
      return { role: rawSource, source: rawSource };
    }

    const rawUserId = typeof raw.userId === 'string' ? raw.userId : '';
    const rawAgentId = typeof raw.agentId === 'string' ? raw.agentId : '';

    if (rawAgentId) {
      return { role: 'assistant', source: 'assistant' };
    }

    if (rawUserId && rawUserId === userId) {
      return { role: 'user', source: 'user' };
    }

    return { role: 'assistant', source: 'assistant' };
  }
}
