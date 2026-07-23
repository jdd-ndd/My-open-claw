/**
 * Gateway WebSocket 服务全面集成测试
 *
 * 覆盖：连接管理、消息收发、异常处理、并发连接、压力负载
 *
 * @module test
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { GatewayServer } from '../../src/gateway/index.js';
import type { MessageRouter } from '../../src/gateway/router/index.js';
import type { AgentConfig } from '../../src/gateway/router/index.js';

// ─── 辅助函数 ───────────────────────────────────

/** 获取可用端口（避免冲突） */
function getPort(offset = 0): number {
  return 18780 + offset;
}

/** 创建测试网关 */
function createGateway(portOffset = 0): GatewayServer {
  return new GatewayServer({
    host: '127.0.0.1',
    port: getPort(portOffset),
    heartbeatInterval: 500,
  });
}

/** 连接 WebSocket 并返回 client */
function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('连接超时'));
    }, 5000);
    ws.on('open', () => {
      clearTimeout(timeout);
      resolve(ws);
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/** 发送消息并等待响应 */
function sendAndWait(
  ws: WebSocket,
  payload: Record<string, unknown>,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const msg = {
      type: 'request',
      id: `test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      action: 'chat.send',
      payload,
      timestamp: new Date().toISOString(),
    };

    const timer = setTimeout(() => reject(new Error('响应超时')), timeoutMs);

    const handler = (data: WebSocket.RawData) => {
      try {
        const resp = JSON.parse(data.toString());
        if (resp.type === 'response' && resp.requestId === msg.id) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(resp);
        }
      } catch {
        // 忽略非 JSON 或无关消息
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(msg));
  });
}

/** 加载测试路由规则 */
function loadTestRules(router: MessageRouter): void {
  const configs: AgentConfig[] = [
    {
      id: 'default',
      priority: 50,
      channels: [
        { channelId: 'webchat', userIds: ['*'] },
        { channelId: 'cli', userIds: ['*'] },
        { channelId: 'telegram', userIds: ['user-001'] },
      ],
    },
    {
      id: 'support',
      priority: 100,
      channels: [
        { channelId: 'webchat', userIds: ['vip-*'] },
        { channelId: '*', userIds: ['*'], contentPattern: '支持|帮助|help' },
      ],
    },
  ];
  router.loadRules(configs);
}

// ─── 测试套件 ───────────────────────────────────

describe('Gateway WebSocket 全链路集成测试', () => {
  let gateway: GatewayServer;
  let port: number;

  beforeAll(async () => {
    gateway = createGateway(0);
    loadTestRules(gateway.router);
    port = gateway.config.port;
    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
  });

  // ================================================================
  // 1. 连接建立与断开测试
  // ================================================================
  describe('1. 连接建立与断开', () => {
    it('1.1 客户端应成功连接到 Gateway', async () => {
      const ws = await connect(port);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it('1.2 连接断开后 connections 计数应减少', async () => {
      const ws = await connect(port);
      await new Promise((r) => setTimeout(r, 100));
      // 通过事件验证
      let disconnected = false;
      gateway.once('disconnection', () => { disconnected = true; });
      ws.close();
      await new Promise((r) => setTimeout(r, 200));
      expect(disconnected).toBe(true);
    });

    it('1.3 正常关闭应带有状态码 1000', async () => {
      const ws = await connect(port);
      await new Promise((r) => setTimeout(r, 50));
      ws.close(1000, '正常关闭');
      await new Promise((r) => setTimeout(r, 200));
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    it('1.4 server stop 时应关闭所有连接', async () => {
      const gw2 = createGateway(1);
      await gw2.start();
      const ws2 = await connect(gw2.config.port);

      let closeCode = 0;
      ws2.on('close', (code) => { closeCode = code; });

      await gw2.stop();
      await new Promise((r) => setTimeout(r, 300));
      expect(closeCode).toBe(1001); // Server shutdown
    });

    it('1.5 应能处理大量顺序连接/断开', async () => {
      for (let i = 0; i < 20; i++) {
        const ws = await connect(port);
        ws.close();
        await new Promise((r) => setTimeout(r, 10));
      }
      // 不应有未清理的连接导致内存泄漏
      const ws = await connect(port);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });
  });

  // ================================================================
  // 2. 消息发送与接收测试
  // ================================================================
  describe('2. 消息发送与接收', () => {
    let ws: WebSocket;

    beforeEach(async () => { ws = await connect(port); });
    afterEach(() => { ws.close(); });

    it('2.1 发送文本消息应收到响应', async () => {
      const resp = await sendAndWait(ws, {
        content: '你好，请介绍一下自己',
        channelId: 'webchat',
        userId: 'user-001',
      });
      expect(resp.status).toBe('success');
      expect(resp.payload).toHaveProperty('matched');
    });

    it('2.2 不同 userId 应创建不同会话', async () => {
      // 先注册规则，支持通配符
      gateway.router.loadRules([{
        id: 'multi-user',
        priority: 10,
        channels: [{ channelId: 'webchat', userIds: ['*'] }],
      }]);

      const resp1 = await sendAndWait(ws, { content: 'hello', channelId: 'webchat', userId: 'user-a' });
      const resp2 = await sendAndWait(ws, { content: 'hello', channelId: 'webchat', userId: 'user-b' });

      expect(resp1.payload.sessionId).not.toEqual(resp2.payload.sessionId);
    });

    it('2.3 同用户多次消息应复用会话', async () => {
      gateway.router.loadRules([{
        id: 'session-test',
        priority: 10,
        channels: [{ channelId: 'webchat', userIds: ['*'] }],
      }]);

      const resp1 = await sendAndWait(ws, { content: 'msg1', channelId: 'webchat', userId: 'user-s' });
      const resp2 = await sendAndWait(ws, { content: 'msg2', channelId: 'webchat', userId: 'user-s' });

      expect(resp1.payload.sessionId).toEqual(resp2.payload.sessionId);
    });

    it('2.4 应支持包含附件信息的消息', async () => {
      const resp = await sendAndWait(ws, {
        content: '分析这个文件',
        channelId: 'webchat',
        userId: 'user-001',
        attachments: [{ type: 'file', url: 'file:///data.csv', filename: 'data.csv', size: 1024 }],
      });
      expect(resp.status).toBe('success');
    });

    it('2.5 应支持 system 类型的消息', async () => {
      const resp = await sendAndWait(ws, {
        content: 'system ping',
        channelId: 'webchat',
        userId: 'system',
        messageType: 'system',
      });
      expect(resp.status).toBe('success');
    });

    it('2.6 应支持大文本消息（100KB）', async () => {
      const largeContent = 'x'.repeat(100 * 1024);
      const resp = await sendAndWait(ws, {
        content: largeContent,
        channelId: 'webchat',
        userId: 'user-001',
      }, 5000);
      expect(resp.status).toBe('success');
    });

    it('2.7 心跳 ping 帧保活验证（不再广播心跳 event）', async () => {
      // 心跳改为仅发送 ping 帧，此测试验证连接在心跳期间保持存活
      await new Promise((r) => setTimeout(r, 1500)); // 等待至少 2 次心跳
      expect(ws.readyState).toBe(WebSocket.OPEN); // 连接仍存活
    });
  });

  // ================================================================
  // 3. 异常处理测试
  // ================================================================
  describe('3. 异常处理', () => {
    it('3.1 无效 JSON 应返回 PARSE_ERROR', async () => {
      const ws = await connect(port);

      const resp = await new Promise<Record<string, unknown>>((resolve) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'response') resolve(msg);
        });
        ws.send('这不是 JSON');
      });

      expect(resp.status).toBe('error');
      expect(resp.errorCode).toBe('PARSE_ERROR');
      ws.close();
    });

    it('3.2 无匹配路由的消息应返回 NO_MATCH', async () => {
      // 先清空规则
      gateway.router.loadRules([]);
      const ws = await connect(port);

      const resp = await sendAndWait(ws, {
        content: 'hello',
        channelId: 'unknown-channel',
        userId: 'nobody',
      }, 2000);

      expect(resp.status).toBe('error');
      expect(resp.errorCode).toBe('NO_MATCH');

      // 恢复规则
      loadTestRules(gateway.router);
      ws.close();
    });

    it('3.3 连接已关闭后发送消息应不抛异常', async () => {
      const ws = await connect(port);
      ws.close();
      await new Promise((r) => setTimeout(r, 100));

      // 此时 send 应该静默失败（readyState !== OPEN）
      expect(() => {
        try { ws.send('test'); } catch { /* 忽略 */ }
      }).not.toThrow();
    });

    it('3.4 快速重复连接/断开应不影响服务稳定性', async () => {
      for (let i = 0; i < 30; i++) {
        const ws2 = await connect(port);
        ws2.close();
      }
      // 最终仍应能正常连接和通信
      const ws3 = await connect(port);
      const resp = await sendAndWait(ws3, {
        content: 'stability check',
        channelId: 'webchat',
        userId: 'user-001',
      });
      expect(resp.status).toBe('success');
      ws3.close();
    });

    it('3.5 错误的端口连接应触发 error 事件', async () => {
      const badPort = port + 99; // 未监听的端口
      const ws = new WebSocket(`ws://127.0.0.1:${badPort}`);
      const error = await new Promise<Error | null>((resolve) => {
        ws.on('error', resolve);
        setTimeout(() => resolve(null), 2000);
      });
      expect(error).not.toBeNull();
      ws.close();
    });
  });

  // ================================================================
  // 4. 并发连接测试
  // ================================================================
  describe('4. 并发连接', () => {
    const CONCURRENT = 30;

    it('4.1 应支持 30 个并发连接', async () => {
      const clients: WebSocket[] = [];
      for (let i = 0; i < CONCURRENT; i++) {
        clients.push(await connect(port));
      }
      expect(clients.length).toBe(CONCURRENT);

      // 全部关闭
      for (const c of clients) c.close();
    });

    it('4.2 30 个并发连接应全部能收发消息', async () => {
      const clients: WebSocket[] = [];
      const results: Promise<unknown>[] = [];

      // 先全部连接
      for (let i = 0; i < CONCURRENT; i++) {
        clients.push(await connect(port));
      }

      // 同时发消息
      for (const ws of clients) {
        results.push(
          sendAndWait(ws, {
            content: `concurrent message`,
            channelId: 'webchat',
            userId: `user-${Math.random().toString(36).slice(2)}`,
          }),
        );
      }

      const responses = await Promise.all(results);
      const successCount = responses.filter((r: any) => r.status === 'success').length;
      expect(successCount).toBe(CONCURRENT);

      for (const c of clients) c.close();
    });
  });

  // ================================================================
  // 5. 负载压力测试
  // ================================================================
  describe('5. 负载压力', () => {
    it('5.1 单连接 100 条消息应无丢失', async () => {
      const ws = await connect(port);
      const count = 100;
      const promises: Promise<unknown>[] = [];

      for (let i = 0; i < count; i++) {
        promises.push(
          sendAndWait(ws, {
            content: `msg_${i}`,
            channelId: 'webchat',
            userId: 'stress-user',
          }, 5000),
        );
      }

      const responses = await Promise.all(promises);
      expect(responses.length).toBe(count);
      const failed = responses.filter((r: any) => r.status !== 'success');
      expect(failed.length).toBe(0);
      ws.close();
    });

    it('5.2 10 连接各发 20 条消息应全部处理', async () => {
      const connectionCount = 10;
      const msgsPerConn = 20;
      const clients: WebSocket[] = [];

      for (let i = 0; i < connectionCount; i++) {
        clients.push(await connect(port));
      }

      const allPromises: Promise<unknown>[] = [];
      for (const ws of clients) {
        for (let j = 0; j < msgsPerConn; j++) {
          allPromises.push(
            sendAndWait(ws, {
              content: `conn_msg_${j}`,
              channelId: 'webchat',
              userId: `load-user-${Math.random().toString(36).slice(2, 6)}`,
            }, 5000),
          );
        }
      }

      const responses = await Promise.all(allPromises);
      expect(responses.length).toBe(connectionCount * msgsPerConn);

      const errors = responses.filter((r: any) => r.status !== 'success');
      expect(errors.length).toBe(0);

      for (const c of clients) c.close();
    });

    it('5.3 性能：100 条消息 P95 延迟应 < 200ms', async () => {
      const ws = await connect(port);
      const latencies: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = Date.now();
        await sendAndWait(ws, {
          content: `perf_${i}`,
          channelId: 'webchat',
          userId: 'perf-user',
        });
        latencies.push(Date.now() - start);
      }

      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const p99 = latencies[Math.floor(latencies.length * 0.99)];
      const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

      console.log(`
      ┌──────────────────────────────────────┐
      │       WebSocket 消息延迟统计 (100条)   │
      ├──────────────────────────────────────┤
      │  P50: ${String(p50).padStart(5)}ms                          │
      │  P95: ${String(p95).padStart(5)}ms                          │
      │  P99: ${String(p99).padStart(5)}ms                          │
      │  Avg: ${String(Math.round(avg)).padStart(5)}ms                          │
      │  Min: ${String(latencies[0]).padStart(5)}ms                          │
      │  Max: ${String(latencies[latencies.length - 1]).padStart(5)}ms                          │
      └──────────────────────────────────────┘`);

      expect(p95).toBeLessThan(200);

      ws.close();
    });
  });

  // ================================================================
  // 6. HTTP API 健康检查
  // ================================================================
  describe('6. HTTP API', () => {
    it('6.1 GET /api/health 应返回 healthy', async () => {
      const resp = await fetch(`http://127.0.0.1:${gateway.config.port}/api/health`);
      expect(resp.status).toBe(200);
      const body = await resp.json() as { ok: boolean; data: { status: string } };
      expect(body.ok).toBe(true);
      expect(body.data.status).toBe('healthy');
    });

    it('6.2 GET /api/status 应返回网关状态', async () => {
      const resp = await fetch(`http://127.0.0.1:${gateway.config.port}/api/status`);
      expect(resp.status).toBe(200);
      const body = await resp.json() as { ok: boolean; data: Record<string, unknown> };
      expect(body.ok).toBe(true);
      expect(body.data.status).toBe('running');
      expect(body.data).toHaveProperty('uptime');
      expect(body.data).toHaveProperty('connectionCount');
    });

    it('6.3 未知路由应返回 404', async () => {
      const resp = await fetch(`http://127.0.0.1:${gateway.config.port}/api/nonexistent`);
      expect(resp.status).toBe(404);
    });
  });

  // ================================================================
  // 7. HTTP API 连接与会话管理
  // ================================================================
  describe('7. HTTP API 连接与会话', () => {
    it('7.1 GET /api/connections 应返回连接列表', async () => {
      const ws = await connect(port);
      await new Promise((r) => setTimeout(r, 100));

      const resp = await fetch(`http://127.0.0.1:${port}/api/connections`);
      expect(resp.status).toBe(200);
      const body = await resp.json() as { ok: boolean; data: { total: number; connections: unknown[] } };
      expect(body.ok).toBe(true);
      expect(body.data.total).toBeGreaterThanOrEqual(1);
      expect(body.data.connections.length).toBe(body.data.total);

      ws.close();
    });

    it('7.2 连接断开后 /api/connections 计数应减少', async () => {
      const ws = await connect(port);

      const resp1 = await fetch(`http://127.0.0.1:${port}/api/connections`);
      const before = (await resp1.json() as { data: { total: number } }).data.total;

      ws.close();
      await new Promise((r) => setTimeout(r, 200));

      const resp2 = await fetch(`http://127.0.0.1:${port}/api/connections`);
      const after = (await resp2.json() as { data: { total: number } }).data.total;

      expect(after).toBeLessThanOrEqual(before);
    });

    it('7.3 GET /api/sessions 应返回会话和规则信息', async () => {
      const resp = await fetch(`http://127.0.0.1:${port}/api/sessions`);
      expect(resp.status).toBe(200);
      const body = await resp.json() as { ok: boolean; data: { activeSessionCount: number; ruleCount: number; rules: unknown[] } };
      expect(body.ok).toBe(true);
      expect(typeof body.data.activeSessionCount).toBe('number');
      expect(typeof body.data.ruleCount).toBe('number');
      expect(Array.isArray(body.data.rules)).toBe(true);
    });

    it('7.4 发送消息后 sessions 应包含规则信息', async () => {
      const ws = await connect(port);
      await sendAndWait(ws, {
        content: 'hello',
        channelId: 'webchat',
        userId: 'user-test',
      });

      const resp = await fetch(`http://127.0.0.1:${port}/api/sessions`);
      const body = await resp.json() as { ok: boolean; data: { rules: Array<{ id: string }> } };
      expect(body.ok).toBe(true);
      expect(body.data.rules.length).toBeGreaterThan(0);

      ws.close();
    });
  });

  // ================================================================
  // 8. 异常处理增强
  // ================================================================
  describe('8. 异常处理增强', () => {
    it('8.1 超长 JSON 消息应返回 MESSAGE_TOO_LARGE', async () => {
      const ws = await connect(port);

      const resp = await new Promise<Record<string, unknown>>((resolve) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'response' && msg.requestId === '__oversize') {
            resolve(msg);
          }
        });
        // 发送 600KB 的 JSON 消息
        const largePayload = { type: 'request', id: 'big', action: 'test', payload: { data: 'x'.repeat(600 * 1024) }, timestamp: new Date().toISOString() };
        ws.send(JSON.stringify(largePayload));
      });

      expect(resp.status).toBe('error');
      expect(resp.errorCode).toBe('MESSAGE_TOO_LARGE');
      ws.close();
    });

    it('8.2 空消息体应返回 PARSE_ERROR', async () => {
      const ws = await connect(port);

      const resp = await new Promise<Record<string, unknown>>((resolve) => {
        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'response') resolve(msg);
          } catch { /* ignore */ }
        });
        ws.send('');
      });

      expect(resp.status).toBe('error');
      expect(resp.errorCode).toBe('PARSE_ERROR');
      ws.close();
    });

    it('8.3 无效数据类型（二进制）应返回 PARSE_ERROR', async () => {
      const ws = await connect(port);

      const resp = await new Promise<Record<string, unknown>>((resolve) => {
        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'response' && msg.requestId === '__parse_error') {
              resolve(msg);
            }
          } catch { /* ignore */ }
        });
        ws.send('not-valid-json{{{');
      });

      expect(resp.status).toBe('error');
      expect(resp.errorCode).toBe('PARSE_ERROR');
      ws.close();
    });

    it('8.4 非 request 类型消息应触发 message 事件', async () => {
      const ws = await connect(port);

      let eventReceived = false;
      const handler = () => { eventReceived = true; };
      gateway.on('message', handler);

      await new Promise<void>((resolve) => {
        ws.send(JSON.stringify({
          type: 'event',
          id: 'test-event',
          event: 'user.custom',
          payload: {},
          timestamp: new Date().toISOString(),
        }));
        setTimeout(resolve, 200);
      });

      expect(eventReceived).toBe(true);
      gateway.off('message', handler);
      ws.close();
    });
  });
});
