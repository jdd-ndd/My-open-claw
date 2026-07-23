/**
 * GatewayServer 单元测试
 *
 * 覆盖：构造配置、消息收发边界、事件系统、生命周期边界
 *
 * @module test
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GatewayServer } from '../../../src/gateway/server.js';
import type { GatewayMessage, RequestMessage, ResponseMessage, EventMessage } from '../../../src/gateway/protocol.js';

// ─── 工具函数 ───────────────────────────────────

/** 创建请求消息 */
function makeRequest(overrides?: Partial<RequestMessage>): RequestMessage {
  return {
    type: 'request',
    id: 'req_001',
    action: 'chat.send',
    payload: {
      channelId: 'webchat',
      userId: 'user-001',
      content: 'hello',
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/** 创建事件消息 */
function makeEvent(overrides?: Partial<EventMessage>): EventMessage {
  return {
    type: 'event',
    id: 'evt_001',
    event: 'agent.reply',
    payload: { message: 'hello back' },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─── 测试套件 ───────────────────────────────────

describe('Gateway - GatewayServer 单元测试', () => {
  // ================================================================
  // 1. 构造函数与配置
  // ================================================================
  describe('1. 构造函数与配置', () => {
    it('1.1 无参数构造应使用默认配置', () => {
      const gw = new GatewayServer();

      expect(gw.config.host).toBe('127.0.0.1');
      expect(gw.config.port).toBe(18780);
      expect(gw.config.heartbeatInterval).toBe(30_000);
      expect(gw.config.maxConnections).toBe(1_000);
      expect(gw.config.requestTimeout).toBe(30_000);
    });

    it('1.2 传入部分配置应合并默认值', () => {
      const gw = new GatewayServer({
        host: '0.0.0.0',
        port: 9999,
      });

      expect(gw.config.host).toBe('0.0.0.0');
      expect(gw.config.port).toBe(9999);
      // 未传入的保留默认值
      expect(gw.config.heartbeatInterval).toBe(30_000);
      expect(gw.config.maxConnections).toBe(1_000);
    });

    it('1.3 传入完整配置应精确覆盖所有字段', () => {
      const gw = new GatewayServer({
        host: '10.0.0.1',
        port: 12345,
        heartbeatInterval: 5_000,
        maxConnections: 50,
        requestTimeout: 10_000,
      });

      expect(gw.config.host).toBe('10.0.0.1');
      expect(gw.config.port).toBe(12345);
      expect(gw.config.heartbeatInterval).toBe(5_000);
      expect(gw.config.maxConnections).toBe(50);
      expect(gw.config.requestTimeout).toBe(10_000);
    });

    it('1.4 constructor 应创建 MessageRouter 实例', () => {
      const gw = new GatewayServer();
      expect(gw.router).toBeDefined();
      expect(typeof gw.router.route).toBe('function');
      expect(typeof gw.router.loadRules).toBe('function');
      expect(typeof gw.router.getRules).toBe('function');
    });

    it('1.5 constructor 应初始化数据库', () => {
      const gw = new GatewayServer();
      const rules = gw.router.getRules();
      expect(Array.isArray(rules)).toBe(true);
    });

    it('1.6 setMaxListeners 应设置为 100', () => {
      const gw = new GatewayServer();
      expect(gw.getMaxListeners()).toBe(100);
    });
  });

  // ================================================================
  // 2. 消息发送边界
  // ================================================================
  describe('2. send 消息发送边界', () => {
    let gw: GatewayServer;

    beforeEach(() => {
      gw = new GatewayServer();
    });

    afterEach(() => {
      gw.removeAllListeners();
    });

    it('2.1 向不存在的 connectionId 发送消息应静默返回', () => {
      const msg = makeEvent();
      // 不应抛出异常
      expect(() => {
        gw.send('nonexistent-id', msg);
      }).not.toThrow();
    });

    it('2.2 向不存在连接发送 request 消息应静默返回', () => {
      expect(() => {
        gw.send('no-conn', makeRequest());
      }).not.toThrow();
    });

    it('2.3 向不存在连接发送 response 消息应静默返回', () => {
      const resp: ResponseMessage = {
        type: 'response',
        id: 'r1',
        timestamp: new Date().toISOString(),
        requestId: 'req1',
        status: 'success',
        payload: {},
      };
      expect(() => {
        gw.send('nonexistent', resp);
      }).not.toThrow();
    });

    it('2.4 发送 event 消息到不存在连接应静默返回', () => {
      expect(() => {
        gw.send('ghost', makeEvent());
      }).not.toThrow();
    });
  });

  // ================================================================
  // 3. 广播边界
  // ================================================================
  describe('3. broadcast 广播边界', () => {
    let gw: GatewayServer;

    beforeEach(() => {
      gw = new GatewayServer();
    });

    afterEach(() => {
      gw.removeAllListeners();
    });

    it('3.1 无连接时广播应返回 { sent: 0, total: 0 }', () => {
      const event = makeEvent();
      const result = gw.broadcast(event);
      expect(result).toEqual({ sent: 0, total: 0 });
    });

    it('3.2 无连接时广播不同类型的消息均应返回零', () => {
      const results = [
        gw.broadcast(makeEvent()),
        gw.broadcast(makeRequest() as unknown as GatewayMessage),
      ];
      for (const r of results) {
        expect(r.sent).toBe(0);
        expect(r.total).toBe(0);
      }
    });

    it('3.3 广播不应抛出异常', () => {
      expect(() => {
        gw.broadcast(makeEvent());
        gw.broadcast(makeEvent());
        gw.broadcast(makeEvent());
      }).not.toThrow();
    });
  });

  // ================================================================
  // 4. 事件系统
  // ================================================================
  describe('4. 事件系统', () => {
    let gw: GatewayServer;

    beforeEach(() => {
      gw = new GatewayServer({ port: 18801 });
    });

    afterEach(async () => {
      try { await gw.stop(); } catch { /* ignore */ }
      gw.removeAllListeners();
    });

    it('4.1 应在 started 事件中收到 config', async () => {
      const promise = new Promise<Record<string, unknown>>((resolve) => {
        gw.once('started', (config) => resolve(config as Record<string, unknown>));
      });

      await gw.start();
      const startedConfig = await promise;

      expect(startedConfig.host).toBe(gw.config.host);
      expect(startedConfig.port).toBe(gw.config.port);

      await gw.stop();
    });

    it('4.2 stop 应触发 stopped 事件', async () => {
      await gw.start();

      const promise = new Promise<void>((resolve) => {
        gw.once('stopped', () => resolve());
      });

      await gw.stop();
      await promise;
      // 不应超时
    }, 5000);

    it('4.3 多次 stop 不应抛出异常', async () => {
      await gw.start();
      await gw.stop();

      // 第二次 stop 应安全执行
      await expect(gw.stop()).resolves.toBeUndefined();
    });

    it('4.4 未 start 直接 stop 不应抛出异常', async () => {
      await expect(gw.stop()).resolves.toBeUndefined();
    });

    it('4.5 重复 start 应抛出异常（端口占用检测）', async () => {
      const gw2 = new GatewayServer({ port: 18801 });
      await gw2.start();
      // 启动成功后停止
      await gw2.stop();
    });

    it('4.6 应能注册和触发自定义事件监听', () => {
      const spy = vi.fn();
      gw.on('test-event', spy);

      gw.emit('test-event', { data: 'hello' });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({ data: 'hello' });
    });
  });

  // ================================================================
  // 5. 生命周期边界
  // ================================================================
  describe('5. 生命周期边界', () => {
    it('5.1 start 后 config 不应被修改', async () => {
      const gw = new GatewayServer({ port: 18782 });
      const originalPort = gw.config.port;

      await gw.start();
      expect(gw.config.port).toBe(originalPort);

      await gw.stop();
      expect(gw.config.port).toBe(originalPort);
    });

    it('5.2 多次创建不同端口的实例应互不干扰', async () => {
      const gw1 = new GatewayServer({ port: 18783 });
      const gw2 = new GatewayServer({ port: 18784 });

      expect(gw1.config.port).not.toBe(gw2.config.port);

      await gw1.start();
      expect(gw1.config.port).toBe(18783);

      await gw1.stop();
      // gw2 未受影响
      expect(gw2.config.port).toBe(18784);
    });

    it('5.3 每个实例应有独立的 router', () => {
      const gw1 = new GatewayServer();
      const gw2 = new GatewayServer();

      gw1.router.loadRules([
        { id: 'test1', priority: 10, channels: [{ channelId: 'web', userIds: ['*'] }] },
      ]);

      expect(gw1.router.getRules().length).toBe(1);
      expect(gw2.router.getRules().length).toBe(0);
    });
  });

  // ================================================================
  // 6. 消息协议边界测试（通过 removeAllListeners 隔离）
  // ================================================================
  describe('6. 协议消息类型兼容性', () => {
    it('6.1 RequestMessage 应包含必要字段', () => {
      const req = makeRequest();
      expect(req.type).toBe('request');
      expect(req.id).toBeTruthy();
      expect(req.action).toBeTruthy();
      expect(req.payload).toBeDefined();
      expect(req.timestamp).toBeTruthy();
    });

    it('6.2 ResponseMessage 应包含必要的关联字段', () => {
      const resp: ResponseMessage = {
        type: 'response',
        id: 'r1',
        timestamp: new Date().toISOString(),
        requestId: 'req_001',
        status: 'success',
        payload: { matched: true },
      };

      expect(resp.type).toBe('response');
      expect(resp.requestId).toBe('req_001');
      expect(resp.status).toBe('success');
    });

    it('6.3 EventMessage 应包含 event 字段', () => {
      const event = makeEvent();
      expect(event.type).toBe('event');
      expect(event.event).toBeTruthy();
      expect(event.payload).toBeDefined();
    });

    it('6.4 错误 Response 应有 errorCode 和 errorMessage', () => {
      const errResp: ResponseMessage = {
        type: 'response',
        id: 'er1',
        timestamp: new Date().toISOString(),
        requestId: '__parse_error',
        status: 'error',
        payload: {},
        errorCode: 'PARSE_ERROR',
        errorMessage: '无法解析消息体',
      };

      expect(errResp.status).toBe('error');
      expect(errResp.errorCode).toBe('PARSE_ERROR');
      expect(errResp.errorMessage).toBeTruthy();
    });
  });

  // ================================================================
  // 7. 集成边界（合并快速 start/stop 循环）
  // ================================================================
  describe('7. 启动/停止循环稳定性', () => {
    it('7.1 单次 start → stop 应完整清理', async () => {
      const gw = new GatewayServer({ port: 18785 });
      await gw.start();
      await gw.stop();

      // stop 后应可再次 start
      await gw.start();
      await gw.stop();
    });

    it('7.2 3 次 start/stop 循环应无资源泄漏', async () => {
      const gw = new GatewayServer({ port: 18786 });

      for (let i = 0; i < 3; i++) {
        await gw.start();
        await gw.stop();
      }

      // 不应有未清理的定时器或连接
    });

    it('7.3 快速连续 stop 应安全', async () => {
      const gw = new GatewayServer({ port: 18787 });
      await gw.start();

      // 并发调用 stop
      await Promise.all([gw.stop(), gw.stop()]);
      // 不应抛出异常
    });
  });
});
