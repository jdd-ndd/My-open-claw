/**
 * Gateway 消息路由器 —— MessageRouter
 *
 * 负责根据路由规则将标准化消息分发到目标 Agent。
 * 基于注入的 MemoryStorage 实现会话和消息的持久化存储，
 * 内部维护会话缓存以加速路由查找。
 *
 * @module @myopenclaw/server/gateway/router
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../core/utils/logger.js';
import type { MemoryStorage, StorageRow } from '../core/storage.js';
import type {
  NormalizedMessage,
  RoutingRule,
  Session,
  RouteResult,
} from './types.js';

const log = createLogger('gateway:message-router');

/**
 * Agent 配置接口
 *
 * 每个 Agent 可配置多个渠道路由规则，
 * 指定该 Agent 处理来自哪些渠道和用户的消息。
 */
export interface AgentConfig {
  /** Agent 唯一标识 */
  id: string;
  /** 全局优先级（可选，数字越小越优先） */
  priority?: number;
  /** 渠道路由配置列表 */
  channels: Array<{
    /** 渠道 ID（'*' 表示所有渠道） */
    channelId: string;
    /** 用户 ID 列表（'*' 表示所有用户，可选） */
    userIds?: string[];
    /** 内容正则匹配模式（可选） */
    contentPattern?: string;
  }>;
}

/**
 * 消息路由器
 *
 * 继承 EventEmitter，在关键路由事件（匹配成功、未匹配、会话创建等）
 * 时发出事件，供 Gateway 层和监控模块订阅。
 */
export class MessageRouter extends EventEmitter {
  /** 路由规则列表（按优先级升序排列） */
  private rules: RoutingRule[] = [];

  /** 会话缓存（key: "channelId:userId" → Session） */
  private sessionCache = new Map<string, Session>();

  /** 内存存储实例（构造函数注入，与 AuditLogger / TaskScheduler 共享） */
  private storage: MemoryStorage;

  constructor(storage: MemoryStorage) {
    super();
    this.storage = storage;
  }

  // ──────────────────────────────────────────────
  // 初始化
  // ──────────────────────────────────────────────

  /**
   * 初始化数据库表结构
   *
   * 在内存存储中创建 sessions 和 messages 两张表。
   */
  initDatabase(): void {
    this.storage.ensureTable('sessions', `
      session_id   TEXT PRIMARY KEY,
      channel_id   TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      agent_id     TEXT NOT NULL,
      created_at   INTEGER NOT NULL,
      last_active  INTEGER NOT NULL,
      status       TEXT DEFAULT 'active'
    `);

    this.storage.ensureTable('messages', `
      message_id   TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL,
      content      TEXT NOT NULL,
      msg_type     TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      created_at   INTEGER NOT NULL
    `);

    log.info('路由存储表初始化完成');
  }

  /**
   * 从 Agent 配置列表中加载路由规则
   *
   * @param agentConfigs - Agent 配置对象列表
   */
  loadRules(agentConfigs: AgentConfig[]): void {
    const loadedRules: RoutingRule[] = [];

    for (const agent of agentConfigs) {
      const basePriority = agent.priority ?? 100;

      for (const [index, channel] of agent.channels.entries()) {
        loadedRules.push({
          id: `rule_${agent.id}_${index}`,
          priority: basePriority + index,
          channelId: channel.channelId,
          userIds: channel.userIds ?? ['*'],
          contentPattern: channel.contentPattern,
          agentId: agent.id,
          enabled: true,
        });
      }
    }

    this.rules = loadedRules.sort((a, b) => a.priority - b.priority);
    log.info({ count: this.rules.length }, '路由规则加载完成');
  }

  // ──────────────────────────────────────────────
  // 路由核心
  // ──────────────────────────────────────────────

  /**
   * 路由一条标准化消息
   */
  async route(message: NormalizedMessage): Promise<RouteResult> {
    const matchedRule = this.matchRule(message);

    if (!matchedRule) {
      log.warn(
        { channelId: message.channelId, userId: message.userId },
        '未匹配到任何路由规则',
      );
      this.emit('route:unmatched', message);
      return {
        matched: false,
        message,
        reason: `未找到匹配的路由规则: channelId=${message.channelId}, userId=${message.userId}`,
      };
    }

    log.debug({ agentId: matchedRule.agentId, ruleId: matchedRule.id }, '路由规则匹配成功');

    const session = this.getOrCreateSession(
      message.channelId,
      message.userId,
      matchedRule.agentId,
    );

    this.persistMessage(session, message);
    this.updateSessionActivity(session.sessionId);

    const result: RouteResult = {
      matched: true,
      agentId: matchedRule.agentId,
      session,
      message,
    };

    this.emit('route:matched', result);
    return result;
  }

  /**
   * 匹配路由规则
   */
  private matchRule(message: NormalizedMessage): RoutingRule | null {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      if (rule.channelId !== '*' && rule.channelId !== message.channelId) continue;

      const userIdMatch =
        rule.userIds.includes('*') || rule.userIds.includes(message.userId);
      if (!userIdMatch) continue;

      if (rule.contentPattern) {
        try {
          const regex = new RegExp(rule.contentPattern, 'i');
          if (!regex.test(message.content)) continue;
        } catch {
          log.warn({ ruleId: rule.id, pattern: rule.contentPattern }, '无效的正则模式');
          continue;
        }
      }

      return rule;
    }

    return null;
  }

  /**
   * 获取或创建会话
   */
  private getOrCreateSession(channelId: string, userId: string, agentId: string): Session {
    const cacheKey = `${channelId}:${userId}`;

    // 1. 查询缓存
    const cached = this.sessionCache.get(cacheKey);
    if (cached && cached.status !== 'closed') {
      log.debug({ sessionId: cached.sessionId }, '命中会话缓存');
      return cached;
    }

    // 2. 查询存储中已有的活跃会话
    const allSessions = this.storage.prepare('SELECT * FROM sessions').all();
    const existing = allSessions.find(
      (row) => row.channel_id === channelId && row.user_id === userId && row.status !== 'closed',
    );

    if (existing) {
      const session = this.rowToSession(existing);
      this.sessionCache.set(cacheKey, session);
      log.debug({ sessionId: session.sessionId }, '从存储恢复会话');
      return session;
    }

    // 3. 创建新会话
    const now = Date.now();
    const session: Session = {
      sessionId: `sess_${now}_${randomUUID().slice(0, 8)}`,
      channelId,
      userId,
      agentId,
      createdAt: now,
      lastActiveAt: now,
      status: 'active',
      messageIds: [],
    };

    this.storage
      .prepare(
        'INSERT INTO sessions (session_id, channel_id, user_id, agent_id, created_at, last_active, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        session.sessionId,
        session.channelId,
        session.userId,
        session.agentId,
        session.createdAt,
        session.lastActiveAt,
        session.status,
      );

    this.sessionCache.set(cacheKey, session);
    log.info({ sessionId: session.sessionId, agentId }, '新建会话');
    this.emit('session:created', session);

    return session;
  }

  /**
   * 持久化消息
   */
  private persistMessage(session: Session, message: NormalizedMessage): void {
    this.storage
      .prepare(
        'INSERT INTO messages (message_id, session_id, content, msg_type, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        message.messageId,
        session.sessionId,
        message.content,
        message.messageType,
        message.userId,
        message.timestamp,
      );

    session.messageIds.push(message.messageId);
  }

  /**
   * 更新会话活跃时间
   */
  private updateSessionActivity(sessionId: string): void {
    const now = Date.now();

    for (const [, session] of this.sessionCache) {
      if (session.sessionId === sessionId) {
        session.lastActiveAt = now;
        session.status = 'active';
        break;
      }
    }

    const row = this.storage.prepare('SELECT * FROM sessions').get(sessionId);
    if (row) {
      // 使用 INSERT OR REPLACE 语义：删除 + 重新插入
      this.storage
        .prepare(
          'INSERT INTO sessions (session_id, channel_id, user_id, agent_id, created_at, last_active, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          row.session_id,
          row.channel_id,
          row.user_id,
          row.agent_id,
          row.created_at,
          now,
          'active',
        );
    }
  }

  // ──────────────────────────────────────────────
  // 会话管理
  // ──────────────────────────────────────────────

  /**
   * 关闭会话
   */
  closeSession(sessionId: string): void {
    for (const [key, session] of this.sessionCache) {
      if (session.sessionId === sessionId) {
        session.status = 'closed';
        this.sessionCache.delete(key);
        break;
      }
    }

    const row = this.storage.prepare('SELECT * FROM sessions').get(sessionId);
    if (row) {
      this.storage
        .prepare(
          'INSERT INTO sessions (session_id, channel_id, user_id, agent_id, created_at, last_active, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          row.session_id,
          row.channel_id,
          row.user_id,
          row.agent_id,
          row.created_at,
          row.last_active,
          'closed',
        );
    }

    log.info({ sessionId }, '会话已关闭');
    this.emit('session:closed', sessionId);
  }

  /**
   * 获取会话历史消息
   */
  getSessionHistory(sessionId: string, limit = 20): NormalizedMessage[] {
    const allMessages = this.storage.prepare('SELECT * FROM messages').all();

    const sessionMessages = allMessages
      .filter((row) => row.session_id === sessionId)
      .map((row) => this.rowToMessage(row));

    sessionMessages.sort((a, b) => b.timestamp - a.timestamp);
    const recent = sessionMessages.slice(0, limit);
    recent.reverse();

    return recent;
  }

  // ──────────────────────────────────────────────
  // 行转换工具（使用语义化列名）
  // ──────────────────────────────────────────────

  /**
   * 将存储行转换为 Session 对象
   */
  private rowToSession(row: StorageRow): Session {
    return {
      sessionId: String(row.session_id ?? ''),
      channelId: String(row.channel_id ?? ''),
      userId: String(row.user_id ?? ''),
      agentId: String(row.agent_id ?? ''),
      createdAt: Number(row.created_at ?? 0),
      lastActiveAt: Number(row.last_active ?? 0),
      status: (row.status as Session['status']) ?? 'active',
      messageIds: [],
    };
  }

  /**
   * 将存储行转换为 NormalizedMessage 对象
   */
  private rowToMessage(row: StorageRow): NormalizedMessage {
    return {
      messageId: String(row.message_id ?? ''),
      channelId: '', // 消息表中不直接存 channelId，通过会话关联
      userId: String(row.user_id ?? ''),
      content: String(row.content ?? ''),
      messageType: (row.msg_type as NormalizedMessage['messageType']) ?? 'text',
      raw: {},
      timestamp: Number(row.created_at ?? 0),
    };
  }

  /**
   * 获取当前规则列表的快照（只读）
   */
  getRules(): ReadonlyArray<RoutingRule> {
    return this.rules;
  }

  /**
   * 获取当前活跃会话数量
   */
  get activeSessionCount(): number {
    return this.sessionCache.size;
  }
}
