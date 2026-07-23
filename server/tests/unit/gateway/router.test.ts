/**
 * Gateway Router 单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MessageRouter } from '../../../src/gateway/router/index.js';
import type { NormalizedMessage } from '../../../src/gateway/router/types.js';
import type { AgentConfig } from '../../../src/gateway/router/index.js';

// ── 工具函数 ──────────────────────────────────────────────

function makeMsg(overrides?: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    messageId: 'msg_' + Math.random().toString(36).slice(2),
    channelId: 'webchat',
    userId: 'user-001',
    content: 'hello',
    messageType: 'text',
    raw: {},
    timestamp: Date.now(),
    ...overrides,
  };
}

const agentConfigs: AgentConfig[] = [
  {
    id: 'default',
    priority: 50,
    channels: [{ channelId: 'webchat', userIds: ['*'] }],
  },
];

// ── 测试套件 ──────────────────────────────────────────────

describe('MessageRouter', () => {
  let router: MessageRouter;

  beforeEach(() => {
    router = new MessageRouter();
  });

  // ── 初始化 ──────────────────────────────────────────

  describe('initDatabase', () => {
    it('初始化数据库应创建 sessions 和 messages 表', () => {
      router.initDatabase();

      const tables = (router as any)['storage'].tables as Map<string, unknown>;
      expect(tables.has('sessions')).toBe(true);
      expect(tables.has('messages')).toBe(true);
    });

    it('重复调用 initDatabase 不应报错', () => {
      router.initDatabase();
      expect(() => router.initDatabase()).not.toThrow();
    });
  });

  // ── 规则加载 ────────────────────────────────────────

  describe('loadRules', () => {
    it('加载规则应按 priority 升序排列', () => {
      const configs: AgentConfig[] = [
        { id: 'low', priority: 100, channels: [{ channelId: 'webchat', userIds: ['*'] }] },
        { id: 'high', priority: 10, channels: [{ channelId: 'webchat', userIds: ['*'] }] },
      ];

      router.loadRules(configs);
      const rules = router.getRules();

      expect(rules).toHaveLength(2);
      expect(rules[0].agentId).toBe('high');
      expect(rules[1].agentId).toBe('low');
    });

    it('未指定 priority 时默认值为 100', () => {
      const configs: AgentConfig[] = [
        { id: 'default', channels: [{ channelId: 'webchat', userIds: ['*'] }] },
      ];

      router.loadRules(configs);
      const rules = router.getRules();

      expect(rules).toHaveLength(1);
      expect(rules[0].priority).toBe(100);
    });

    it('多个渠道配置应展开为多条规则', () => {
      const configs: AgentConfig[] = [
        {
          id: 'multi',
          priority: 50,
          channels: [
            { channelId: 'webchat', userIds: ['*'] },
            { channelId: 'telegram', userIds: ['*'] },
          ],
        },
      ];

      router.loadRules(configs);
      const rules = router.getRules();

      expect(rules).toHaveLength(2);
      expect(rules[0].channelId).toBe('webchat');
      expect(rules[1].channelId).toBe('telegram');
    });
  });

  // ── 路由 ────────────────────────────────────────────

  describe('route', () => {
    beforeEach(() => {
      router.initDatabase();
      router.loadRules(agentConfigs);
    });

    it('匹配到规则时应创建会话并返回 matched=true', async () => {
      const msg = makeMsg();
      const result = await router.route(msg);

      expect(result.matched).toBe(true);
      expect(result.agentId).toBe('default');
      expect(result.session).toBeDefined();
      expect(result.session!.channelId).toBe(msg.channelId);
      expect(result.session!.userId).toBe(msg.userId);
      expect(result.session!.status).toBe('active');
      expect(result.session!.sessionId).toMatch(/^sess_/);
      expect(result.message).toBe(msg);
    });

    it('未匹配到规则时应返回 matched=false 及原因', async () => {
      const msg = makeMsg({ channelId: 'unknown-channel', userId: 'stranger' });
      const result = await router.route(msg);

      expect(result.matched).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('未找到匹配的路由规则');
    });

    it('同一渠道+用户的第二条消息应复用已有会话', async () => {
      const msg1 = makeMsg({ userId: 'user-reuse' });
      const result1 = await router.route(msg1);
      const sessionId1 = result1.session!.sessionId;

      const msg2 = makeMsg({ userId: 'user-reuse' });
      const result2 = await router.route(msg2);

      expect(result2.matched).toBe(true);
      expect(result2.session!.sessionId).toBe(sessionId1);
    });

    it('规则应支持 channelId 通配符 *', async () => {
      router.loadRules([
        {
          id: 'wildcard-agent',
          priority: 10,
          channels: [{ channelId: '*', userIds: ['*'] }],
        },
      ]);

      const msg = makeMsg({ channelId: 'any-channel' });
      const result = await router.route(msg);

      expect(result.matched).toBe(true);
      expect(result.agentId).toBe('wildcard-agent');
    });

    it('禁用的规则应被跳过', async () => {
      // 直接操作内部规则：注入一条 enabled=false 的规则
      (router as any)['rules'] = [
        {
          id: 'disabled-rule',
          priority: 1,
          channelId: 'webchat',
          userIds: ['*'],
          agentId: 'disabled-agent',
          enabled: false,
        },
        ...router.getRules(),
      ];

      const msg = makeMsg();
      const result = await router.route(msg);

      expect(result.matched).toBe(true);
      // 应该匹配到 'default' 而不是 'disabled-agent'
      expect(result.agentId).toBe('default');
    });

    it('contentPattern 正则匹配应生效', async () => {
      router.loadRules([
        {
          id: 'help-agent',
          priority: 10,
          channels: [{ channelId: 'webchat', userIds: ['*'], contentPattern: '^(帮助|help)' }],
        },
        {
          id: 'default',
          priority: 50,
          channels: [{ channelId: 'webchat', userIds: ['*'] }],
        },
      ]);

      // 匹配含"帮助"的消息
      const msg1 = makeMsg({ content: '帮助我想要退款' });
      const result1 = await router.route(msg1);
      expect(result1.agentId).toBe('help-agent');

      // 不匹配正则的消息应走优先级更低的规则
      const msg2 = makeMsg({ content: '普通消息' });
      const result2 = await router.route(msg2);
      expect(result2.agentId).toBe('default');
    });

    it('contentPattern 无效正则应跳过该规则', async () => {
      router.loadRules([
        {
          id: 'bad-regex',
          priority: 10,
          channels: [{ channelId: 'webchat', userIds: ['*'], contentPattern: '[invalid(' }],
        },
        {
          id: 'fallback',
          priority: 50,
          channels: [{ channelId: 'webchat', userIds: ['*'] }],
        },
      ]);

      const msg = makeMsg();
      const result = await router.route(msg);

      expect(result.agentId).toBe('fallback');
    });
  });

  // ── 会话管理 ────────────────────────────────────────

  describe('closeSession', () => {
    beforeEach(() => {
      router.initDatabase();
      router.loadRules(agentConfigs);
    });

    it('closeSession 应将状态改为 closed 并从缓存中移除', async () => {
      const msg = makeMsg({ userId: 'user-close' });
      const result = await router.route(msg);
      const sessionId = result.session!.sessionId;

      router.closeSession(sessionId);

      // 关闭后缓存应被移除
      expect(router.activeSessionCount).toBe(0);

      // 下一条同一用户的消息应创建新会话
      const msg2 = makeMsg({ userId: 'user-close' });
      const result2 = await router.route(msg2);
      expect(result2.session!.sessionId).not.toBe(sessionId);
    });
  });

  // ── 会话历史 ────────────────────────────────────────

  describe('getSessionHistory', () => {
    beforeEach(() => {
      router.initDatabase();
      router.loadRules(agentConfigs);
    });

    it('新会话的 getSessionHistory 应返回空数组', () => {
      const history = router.getSessionHistory('nonexistent-session');
      expect(history).toEqual([]);
    });

    it('多次路由后 getSessionHistory 应返回消息列表', async () => {
      const msg1 = makeMsg({ userId: 'user-hist', content: '第一条消息' });
      const result1 = await router.route(msg1);
      const sessionId = result1.session!.sessionId;

      const msg2 = makeMsg({ userId: 'user-hist', content: '第二条消息' });
      await router.route(msg2);

      const history = router.getSessionHistory(sessionId);
      expect(history.length).toBeGreaterThanOrEqual(1);
      // 第一条消息应在历史中
      expect(history.some((m: NormalizedMessage) => m.content === '第一条消息')).toBe(true);
    });

    it('getSessionHistory 应支持 limit 参数', async () => {
      const msg = makeMsg({ userId: 'user-limit', content: '测试消息' });
      const result = await router.route(msg);
      const sessionId = result.session!.sessionId;

      // 再发一条
      await router.route(makeMsg({ userId: 'user-limit', content: '另一条消息' }));

      const history = router.getSessionHistory(sessionId, 1);
      expect(history.length).toBe(1);
    });
  });
});
