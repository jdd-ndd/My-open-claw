/**
 * Gateway 模块 — 边界条件与异常场景测试
 *
 * @module server/tests/unit/gateway
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { MemoryStorage } from '../../../src/gateway/core/storage.js';
import { SessionManager } from '../../../src/gateway/sessions/index.js';
import { MessageRouter } from '../../../src/gateway/routing/index.js';
import type { AgentConfig } from '../../../src/gateway/routing/index.js';
import type { NormalizedMessage } from '../../../src/gateway/sessions/types.js';
import { StateManager } from '../../../src/gateway/state/index.js';
import { AuditLogger } from '../../../src/gateway/audit/index.js';
import { TaskScheduler } from '../../../src/gateway/scheduler/index.js';
import { SecuritySandbox } from '../../../src/gateway/security/index.js';

// ══════════════════════════════════════════════════════════════
// MemoryStorage — 异常场景
// ══════════════════════════════════════════════════════════════

describe('MemoryStorage — 异常与边界', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('INSERT INTO 不带列名规范应静默忽略', () => {
    // 不匹配正则，应不插入也不报错
    expect(() => storage.prepare('INSERT INTO users').run('id1', 'name1')).not.toThrow();
    const rows = storage.prepare('SELECT * FROM users').all();
    expect(rows).toHaveLength(0);
  });

  it('INSERT 大量数据应正常', () => {
    storage.ensureTable('big', '');
    const count = 100;
    for (let i = 0; i < count; i++) {
      storage.prepare('INSERT INTO big (id, val) VALUES (?, ?)').run(`id_${i}`, `val_${i}`);
    }
    const rows = storage.prepare('SELECT * FROM big').all();
    expect(rows).toHaveLength(count);
  });

  it('UPDATE 不存在的行应静默返回', () => {
    storage.ensureTable('users', '');
    storage.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('u1', 'alice');
    expect(() => {
      storage.prepare('UPDATE users SET name = ? WHERE id = ?').run('newname', 'nonexistent');
    }).not.toThrow();
  });

  it('UPDATE 不存在的表应静默返回', () => {
    expect(() => storage.prepare('UPDATE missing SET name = ? WHERE id = ?').run('x', 'y')).not.toThrow();
  });

  it('DELETE 不存在的行应静默返回', () => {
    storage.ensureTable('users', '');
    expect(() => storage.prepare('DELETE FROM users WHERE id = ?').run('nonexistent')).not.toThrow();
  });

  it('未知 SQL 类型的 prepare().run 应不报错', () => {
    expect(() => storage.prepare('DROP TABLE users').run()).not.toThrow();
  });

  it('clear 应清除所有数据', () => {
    storage.ensureTable('users', '');
    storage.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run('u1', 'alice');
    expect(storage.prepare('SELECT * FROM users').all()).toHaveLength(1);
    storage.clear();
    expect(storage.prepare('SELECT * FROM users').all()).toHaveLength(0);
  });

  it('transaction 应可执行回调', () => {
    const fn = storage.transaction((a: number, b: number) => a + b);
    expect(fn(1, 2)).toBe(3);
  });

  it('query 不存在的表应返回 undefined (get)', () => {
    const row = storage.prepare('SELECT * FROM ghost_table WHERE id = ?').get('x');
    expect(row).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════
// MessageRouter — 异常场景
// ══════════════════════════════════════════════════════════════

describe('MessageRouter — 异常与边界', () => {
  let storage: MemoryStorage;
  let sessions: SessionManager;
  let router: MessageRouter;

  const makeMsg = (overrides?: Partial<NormalizedMessage>): NormalizedMessage => ({
    messageId: `msg_${Math.random().toString(36).slice(2)}`,
    channelId: 'webchat',
    userId: 'user-001',
    content: 'hello',
    messageType: 'text' as const,
    raw: {},
    timestamp: Date.now(),
    ...overrides,
  });

  beforeEach(() => {
    storage = new MemoryStorage();
    sessions = new SessionManager(storage);
    sessions.initDatabase();
    router = new MessageRouter(sessions);
  });

  it('空规则列表下 route 应返回 unmatched', async () => {
    const result = await router.route(makeMsg());
    expect(result.matched).toBe(false);
    expect(result.reason).toContain('未找到匹配');
  });

  it('route 应发出 route:unmatched 事件', async () => {
    const spy = vi.fn();
    router.on('route:unmatched', spy);
    await router.route(makeMsg());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('匹配成功应发出 route:matched 事件', async () => {
    router.loadRules([{ id: 'a1', channels: [{ channelId: 'webchat', userIds: ['*'] }] }]);
    const spy = vi.fn();
    router.on('route:matched', spy);
    await router.route(makeMsg());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('创建会话应发出 session:created 事件', async () => {
    router.loadRules([{ id: 'a1', channels: [{ channelId: 'webchat', userIds: ['*'] }] }]);
    const spy = vi.fn();
    router.on('session:created', spy);
    await router.route(makeMsg());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('closeSession 应发出 session:closed 事件', async () => {
    router.loadRules([{ id: 'a1', channels: [{ channelId: 'webchat', userIds: ['*'] }] }]);
    const result = await router.route(makeMsg());
    const spy = vi.fn();
    router.on('session:closed', spy);
    router.closeSession(result.session!.sessionId);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('contentPattern 无效正则应跳过该规则', async () => {
    router.loadRules([
      { id: 'a1', channels: [{ channelId: 'webchat', userIds: ['*'], contentPattern: '[invalid(' }] },
      { id: 'a2', channels: [{ channelId: 'webchat', userIds: ['*'] }] },
    ]);
    const result = await router.route(makeMsg());
    expect(result.matched).toBe(true);
    expect(result.agentId).toBe('a2');
  });

  it('channelId 为 * 应匹配任意渠道', async () => {
    router.loadRules([{ id: 'a1', channels: [{ channelId: '*', userIds: ['*'] }] }]);
    const result = await router.route(makeMsg({ channelId: 'qqbot', userId: 'qq_001' }));
    expect(result.matched).toBe(true);
  });

  it('getRules 返回只读快照', () => {
    router.loadRules([{ id: 'a1', channels: [{ channelId: 'web', userIds: ['*'] }] }]);
    const rules1 = router.getRules();
    const rules2 = router.getRules();
    expect(rules1).toEqual(rules2);
    expect(rules1).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════
// StateManager — 异常场景
// ══════════════════════════════════════════════════════════════

describe('StateManager — 异常与边界', () => {
  let sm: StateManager;

  beforeEach(() => {
    sm = new StateManager('1.0.0');
  });

  it('getChannelState 不存在应返回 undefined', () => {
    expect(sm.getChannelState('nonexistent')).toBeUndefined();
  });

  it('getAllChannelStates 无渠道时应返回空数组', () => {
    expect(sm.getAllChannelStates()).toEqual([]);
  });

  it('updateAgentState 同一 agent 多次更新应正确合并', () => {
    sm.updateAgentState('agent-1', { status: 'idle' });
    sm.updateAgentState('agent-1', { status: 'busy' });
    expect(sm.getAgentState('agent-1')?.status).toBe('busy');
  });

  it('getIdleAgents 应过滤非 idle 状态', () => {
    sm.updateAgentState('agent-1', { status: 'idle' });
    sm.updateAgentState('agent-2', { status: 'busy' });
    sm.updateAgentState('agent-3', { status: 'idle' });
    expect(sm.getIdleAgents()).toHaveLength(2);
  });

  it('updateTaskState 不存在的任务应打印 warning 但不报错', () => {
    expect(() => sm.updateTaskState('nonexistent', { status: 'completed' })).not.toThrow();
  });

  it('getSnapshot 应包含全部组件', () => {
    sm.updateChannelState('qqbot', { status: 'connected' });
    sm.updateAgentState('a1', { status: 'idle' });
    sm.addTask({ taskId: 't1', name: 'test', type: 'delay', status: 'pending', agentId: 'a1' });
    const snap = sm.getSnapshot();
    expect(snap.version).toBe('1.0.0');
    expect(snap.channels.size).toBe(1);
    expect(snap.agents.size).toBe(1);
    expect(snap.taskQueue.tasks).toHaveLength(1);
  });

  it('setConfig/getConfig 应缓存配置值', () => {
    sm.setConfig('test_key', { a: 1 });
    const val = sm.getConfig<{ a: number }>('test_key');
    expect(val).toEqual({ a: 1 });
  });

  it('getConfig 不存在的 key 应返回 undefined', () => {
    expect(sm.getConfig('missing')).toBeUndefined();
  });
});
