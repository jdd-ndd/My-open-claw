import { EventEmitter } from 'node:events';
import { createLogger } from '../../core/utils/logger.js';
import type { SessionManager } from '../sessions/index.js';
import type {
  NormalizedMessage,
  RoutingRule,
  RouteResult,
} from './types.js';

const log = createLogger('gateway:message-router');

export interface AgentConfig {
  id: string;
  priority?: number;
  channels: Array<{
    channelId: string;
    userIds?: string[];
    contentPattern?: string;
  }>;
}

export class MessageRouter extends EventEmitter {
  private rules: RoutingRule[] = [];
  private sessions: SessionManager;

  constructor(sessions: SessionManager) {
    super();
    this.sessions = sessions;

    this.sessions.on('session:created', (session) => this.emit('session:created', session));
    this.sessions.on('session:closed', (sessionId) => this.emit('session:closed', sessionId));
  }

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
    log.info({ count: this.rules.length }, 'Routing rules loaded');
  }

  async route(message: NormalizedMessage): Promise<RouteResult> {
    const matchedRule = this.matchRule(message);

    if (!matchedRule) {
      log.warn(
        { channelId: message.channelId, userId: message.userId },
        '未找到匹配的路由规则',
      );
      this.emit('route:unmatched', message);
      return {
        matched: false,
        message,
        reason: `未找到匹配的路由规则: channelId=${message.channelId}, userId=${message.userId}`,
      };
    }

    log.debug({ agentId: matchedRule.agentId, ruleId: matchedRule.id }, 'Routing rule matched');

    const session = this.sessions.resolve(
      message.channelId,
      message.userId,
      matchedRule.agentId,
      message.sessionId,
    );

    this.sessions.persistMessage(session, {
      ...message,
      raw: {
        ...(message.raw && typeof message.raw === 'object' ? message.raw as Record<string, unknown> : {}),
        role: 'user',
        source: 'user',
      },
    });
    this.sessions.touch(session.sessionId);

    const result: RouteResult = {
      matched: true,
      agentId: matchedRule.agentId,
      session,
      message,
    };

    this.emit('route:matched', result);
    return result;
  }

  private matchRule(message: NormalizedMessage): RoutingRule | null {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (rule.channelId !== '*' && rule.channelId !== message.channelId) continue;

      const userIdMatch = rule.userIds.includes('*') || rule.userIds.includes(message.userId);
      if (!userIdMatch) continue;

      if (rule.contentPattern) {
        try {
          const regex = new RegExp(rule.contentPattern, 'i');
          if (!regex.test(message.content)) continue;
        } catch {
          log.warn({ ruleId: rule.id, pattern: rule.contentPattern }, 'Invalid regex pattern');
          continue;
        }
      }

      return rule;
    }

    return null;
  }

  getRules(): ReadonlyArray<RoutingRule> {
    return this.rules;
  }

  initDatabase(): void {
    this.sessions.initDatabase();
  }

  closeSession(sessionId: string): void {
    this.sessions.close(sessionId);
  }

  getSessionHistory(sessionId: string, limit = 20): NormalizedMessage[] {
    return this.sessions.getHistory(sessionId, limit);
  }

  get activeSessionCount(): number {
    return this.sessions.activeCount;
  }
}
