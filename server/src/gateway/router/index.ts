/**
 * Gateway 消息路由器 —— MessageRouter
 *
 * 负责根据路由规则将标准化消息分发到目标 Agent。
 * 基于内存 MemoryStorage 实现会话和消息的持久化存储，
 * 内部维护会话缓存以加速路由查找。
 *
 * @module @myopenclaw/server/gateway/router
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { MemoryStorage } from '../storage.js';
import { createLogger } from '../../core/utils/logger.js';
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
 * 方括号语法兼容默认导出与命名导出之间的互操作。
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

  /** 内存存储实例 */
  private storage: MemoryStorage;

  constructor() {
    super();
    this.storage = new MemoryStorage();
  }

  // ──────────────────────────────────────────────
  // 初始化
  // ──────────────────────────────────────────────

  /**
   * 初始化数据库表结构
   *
   * 在内存存储中创建 sessions 和 messages 两张表。
   * sessions 表存储会话信息，messages 表存储标准化消息。
   */
  initDatabase(): void {
    this.storage.ensureTable(
      'sessions',
      `CREATE TABLE sessions (
        session_id   TEXT PRIMARY KEY,
        channel_id   TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        agent_id     TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        last_active  INTEGER NOT NULL,
        status       TEXT DEFAULT 'active'
      )`
    );

    this.storage.ensureTable(
      'messages',
      `CREATE TABLE messages (
        message_id   TEXT PRIMARY KEY,
        session_id   TEXT NOT NULL,
        content      TEXT NOT NULL,
        msg_type     TEXT NOT NULL,
        user_id      TEXT NOT NULL,
        created_at   INTEGER NOT NULL
      )`
    );

    log.info('路由存储表初始化完成');
  }

  /**
   * 从 Agent 配置列表中加载路由规则
   *
   * 将每个 Agent 的渠道配置展开为独立的 RoutingRule，
   * 按 priority 升序排列后存入 rules 数组。
   *
   * @param agentConfigs - Agent 配置对象列表（如从配置文件读取）
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

    // 按优先级升序排列（数字越小越优先）
    this.rules = loadedRules.sort((a, b) => a.priority - b.priority);
    log.info({ count: this.rules.length }, '路由规则加载完成');
  }

  // ──────────────────────────────────────────────
  // 路由核心
  // ──────────────────────────────────────────────

  /**
   * 路由一条标准化消息
   *
   * 完整路由流水线：
   * 1. 调用 matchRule 匹配目标 Agent
   * 2. 获取或创建会话
   * 3. 将消息持久化到会话中
   * 4. 更新会话活跃时间
   * 5. 返回 RouteResult
   *
   * @param message - 经过标准化的渠道消息
   * @returns 路由结果（包含匹配状态、目标 Agent、会话和消息引用）
   */
  async route(message: NormalizedMessage): Promise<RouteResult> {
    // 步骤 1: 规则匹配
    const matchedRule = this.matchRule(message);

    if (!matchedRule) {
      log.warn(
        { channelId: message.channelId, userId: message.userId },
        '未匹配到任何路由规则'
      );
      this.emit('route:unmatched', message);
      return {
        matched: false,
        message,
        reason: `未找到匹配的路由规则: channelId=${message.channelId}, userId=${message.userId}`,
      };
    }

    log.debug(
      { agentId: matchedRule.agentId, ruleId: matchedRule.id },
      '路由规则匹配成功'
    );

    // 步骤 2: 获取或创建会话
    const session = this.getOrCreateSession(
      message.channelId,
      message.userId,
      matchedRule.agentId
    );

    // 步骤 3: 持久化消息
    this.persistMessage(session, message);

    // 步骤 4: 更新会话活跃时间
    this.updateSessionActivity(session.sessionId);

    // 步骤 5: 返回结果
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
   * 匹配路由规则（私有方法）
   *
   * 按优先级依次遍历规则列表，检查每条规则是否与消息匹配：
   * - channelId 支持通配符 '*' 匹配所有渠道
   * - userIds 支持通配符 '*' 匹配所有用户
   * - contentPattern 可选的正则模式匹配消息内容
   * 仅有 enabled 为 true 的规则参与匹配。
   *
   * @param message - 标准化消息
   * @returns 匹配到的路由规则，未匹配返回 null
   */
  private matchRule(message: NormalizedMessage): RoutingRule | null {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      // 检查渠道 ID 匹配（支持通配符 '*'）
      if (rule.channelId !== '*' && rule.channelId !== message.channelId) {
        continue;
      }

      // 检查用户 ID 匹配（支持通配符 '*'）
      const userIdMatch = rule.userIds.includes('*') || rule.userIds.includes(message.userId);
      if (!userIdMatch) {
        continue;
      }

      // 检查内容匹配（可选）
      if (rule.contentPattern) {
        try {
          const regex = new RegExp(rule.contentPattern, 'i');
          if (!regex.test(message.content)) {
            continue;
          }
        } catch {
          log.warn({ ruleId: rule.id, pattern: rule.contentPattern }, '无效的正则模式');
          continue;
        }
      }

      // 所有条件均满足
      return rule;
    }

    return null;
  }

  /**
   * 获取或创建会话（私有方法）
   *
   * 优先从缓存中查找（key: "channelId:userId"），
   * 缓存未命中则查询内存存储，
   * 仍未找到则创建新会话并写入缓存和存储。
   *
   * @param channelId - 渠道 ID
   * @param userId - 用户 ID
   * @param agentId - Agent ID
   * @returns 现有会话或新建会话
   */
  private getOrCreateSession(
    channelId: string,
    userId: string,
    agentId: string
  ): Session {
    const cacheKey = `${channelId}:${userId}`;

    // 1. 查询缓存
    const cached = this.sessionCache.get(cacheKey);
    if (cached && cached.status !== 'closed') {
      log.debug({ sessionId: cached.sessionId }, '命中会话缓存');
      return cached;
    }

    // 2. 查询存储中已有的活跃会话
    const allSessions = this.storage.prepare('SELECT * FROM sessions').all() as unknown as Array<Record<string, unknown>>;
    const existing = allSessions.find(
      (row) => row.col_1 === channelId && row.col_2 === userId && row.col_6 !== 'closed'
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

    // 写入内存存储
    this.storage
      .prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        session.sessionId,
        session.channelId,
        session.userId,
        session.agentId,
        session.createdAt,
        session.lastActiveAt,
        session.status
      );

    // 写入缓存
    this.sessionCache.set(cacheKey, session);
    log.info({ sessionId: session.sessionId, agentId }, '新建会话');
    this.emit('session:created', session);

    return session;
  }

  /**
   * 持久化消息（私有方法）
   *
   * 将标准化消息写入 messages 表，并将 messageId 追加到会话的 messageIds 列表。
   *
   * @param session - 目标会话
   * @param message - 标准化消息
   */
  private persistMessage(session: Session, message: NormalizedMessage): void {
    // 写入 messages 表
    this.storage
      .prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        message.messageId,
        session.sessionId,
        message.content,
        message.messageType,
        message.userId,
        message.timestamp
      );

    // 更新会话内 messageIds 列表
    session.messageIds.push(message.messageId);
  }

  /**
   * 更新会话活跃时间（私有方法）
   *
   * 将会话的 lastActiveAt 更新为当前时间并设状态为 active，
   * 同步更新缓存和内存存储。
   *
   * @param sessionId - 会话 ID
   */
  private updateSessionActivity(sessionId: string): void {
    const now = Date.now();

    // 遍历缓存找到对应会话并更新
    for (const [, session] of this.sessionCache) {
      if (session.sessionId === sessionId) {
        session.lastActiveAt = now;
        session.status = 'active';
        break;
      }
    }

    // 更新存储中的记录（通过重新插入实现 UPDATE）
    const row = this.storage.prepare('SELECT * FROM sessions').get(sessionId) as unknown as Record<string, unknown> | undefined;
    if (row) {
      this.storage
        .prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          row.col_0,
          row.col_1,
          row.col_2,
          row.col_3,
          row.col_4,
          now,
          'active'
        );
    }
  }

  // ──────────────────────────────────────────────
  // 会话管理
  // ──────────────────────────────────────────────

  /**
   * 关闭会话
   *
   * 将会话状态更新为 closed，从缓存中移除。
   * 关闭后该 channelId+userId 组合的下一条消息将创建新会话。
   *
   * @param sessionId - 要关闭的会话 ID
   */
  closeSession(sessionId: string): void {
    // 从缓存中查找并移除
    for (const [key, session] of this.sessionCache) {
      if (session.sessionId === sessionId) {
        session.status = 'closed';
        this.sessionCache.delete(key);
        break;
      }
    }

    // 更新存储
    const row = this.storage.prepare('SELECT * FROM sessions').get(sessionId) as unknown as Record<string, unknown> | undefined;
    if (row) {
      this.storage
        .prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          row.col_0,
          row.col_1,
          row.col_2,
          row.col_3,
          row.col_4,
          row.col_5,
          'closed'
        );
    }

    log.info({ sessionId }, '会话已关闭');
    this.emit('session:closed', sessionId);
  }

  /**
   * 获取会话历史消息
   *
   * 查询指定会话的消息列表，按创建时间倒序取最近 limit 条后反转为正序返回。
   *
   * @param sessionId - 会话 ID
   * @param limit - 返回消息数量上限（默认 20）
   * @returns 标准化消息数组（时间正序）
   */
  getSessionHistory(sessionId: string, limit = 20): NormalizedMessage[] {
    const allMessages = this.storage
      .prepare('SELECT * FROM messages')
      .all() as unknown as Array<Record<string, unknown>>;

    const sessionMessages = allMessages
      .filter((row) => row.col_1 === sessionId)
      .map((row) => this.rowToMessage(row));

    // 按时间戳倒序 → 截取 → 反转为正序
    sessionMessages.sort((a, b) => b.timestamp - a.timestamp);
    const recent = sessionMessages.slice(0, limit);
    recent.reverse();

    return recent;
  }

  // ──────────────────────────────────────────────
  // 工具方法
  // ──────────────────────────────────────────────

  /**
   * 将存储行转换为 Session 对象
   *
   * @param row - 来自 MemoryStorage 的原始存储行
   * @returns 规范化的 Session 对象
   */
  private rowToSession(row: Record<string, unknown>): Session {
    return {
      sessionId: String(row.col_0 ?? ''),
      channelId: String(row.col_1 ?? ''),
      userId: String(row.col_2 ?? ''),
      agentId: String(row.col_3 ?? ''),
      createdAt: Number(row.col_4 ?? 0),
      lastActiveAt: Number(row.col_5 ?? 0),
      status: (row.col_6 as Session['status']) ?? 'active',
      messageIds: [],
    };
  }

  /**
   * 将存储行转换为 NormalizedMessage 对象
   *
   * @param row - 来自 MemoryStorage 的原始存储行
   * @returns 规范化的 NormalizedMessage 对象
   */
  private rowToMessage(row: Record<string, unknown>): NormalizedMessage {
    return {
      messageId: String(row.col_0 ?? ''),
      channelId: '', // 消息表中不直接存 channelId，通过会话关联
      userId: String(row.col_4 ?? ''),
      content: String(row.col_2 ?? ''),
      messageType: (row.col_3 as NormalizedMessage['messageType']) ?? 'text',
      raw: {},
      timestamp: Number(row.col_5 ?? 0),
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
