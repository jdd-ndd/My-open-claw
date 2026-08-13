/**
 * Memory HTTP routes 集成测试 (v1.1.6+)
 *
 * 覆盖 5 个新增的 /api/memory/* 端点：
 *   GET    /api/memory/sessions
 *   DELETE /api/memory/sessions/:id
 *   GET    /api/memory/vectors/search
 *   DELETE /api/memory/vectors/:id
 *   GET    /api/memory/stats
 *
 * 通过 fastify.inject() 模拟 HTTP 请求，不开真实端口。
 *
 * @module server/tests/integration
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import { MemoryManager } from '../../src/memory/manager.js';
import { AgentRuntimeAdapter } from '../../src/gateway/server/agent-runtime-adapter.js';
import { registerHttpRoutes } from '../../src/gateway/server/http-routes.js';
import type { MemoryMessage } from '../../src/gateway/sessions/types.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'memory-routes-'));
  tempDirs.push(dir);
  return dir;
}

function makeMessage(id: string, role: 'user' | 'assistant', content: string): MemoryMessage {
  return {
    id,
    role,
    content,
    timestamp: Date.now(),
  };
}

interface TestHarness {
  app: FastifyInstance;
  memory: MemoryManager;
  adapter: AgentRuntimeAdapter;
}

async function buildHarness(): Promise<TestHarness> {
  const dataDir = createTempDir();
  const memory = new MemoryManager({ dataDir });
  await memory.initialize();

  // AgentRuntimeAdapter 同步构造, 接受外部 memory 注入.
  // 默认 orchestrator 用 mock LLM, 不会产生真实网络调用, 测试 memory 路由不依赖它.
  const adapter = new AgentRuntimeAdapter({ memory });

  const app = Fastify({ logger: false });
  await registerHttpRoutes(
    app,
    { getMetadataList: () => [] } as never,
    { getRules: () => [] } as never,
    { activeCount: 0, listSessions: () => [] } as never,
    { host: '127.0.0.1', port: 0, maxConnections: 0 } as never,
    { runtimeAdapter: adapter },
  );

  return { app, memory, adapter };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('HTTP /api/memory/* routes', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildHarness();
  });

  afterEach(async () => {
    await harness.app.close();
    await harness.memory.shutdown();
  });

  it('GET /api/memory/stats reports zero counts and embedding provider', async () => {
    const res = await harness.app.inject({ method: 'GET', url: '/api/memory/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.sessions.active).toBe(0);
    expect(body.data.vectors.total).toBe(0);
    expect(body.data.embedding.provider).toBe('local');
    expect(body.data.embedding.available).toBe(false);
  });

  it('GET /api/memory/sessions lists all created sessions', async () => {
    await harness.memory.session.create('s1', { userId: 'u1', channelId: 'c1', agentId: 'a1' });
    await harness.memory.session.create('s2', { userId: 'u2', channelId: 'c1', agentId: 'a1' });

    const res = await harness.app.inject({ method: 'GET', url: '/api/memory/sessions' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.total).toBe(2);
    expect(body.data.sessions.map((s: { sessionId: string }) => s.sessionId).sort()).toEqual(['s1', 's2']);
  });

  it('DELETE /api/memory/sessions/:id removes a session and 404s on missing', async () => {
    await harness.memory.session.create('doomed', { userId: 'u', channelId: 'c', agentId: 'a' });

    const ok = await harness.app.inject({ method: 'DELETE', url: '/api/memory/sessions/doomed' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.deleted).toBe('doomed');

    const missing = await harness.app.inject({ method: 'DELETE', url: '/api/memory/sessions/never-existed' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().ok).toBe(false);
  });

  it('GET /api/memory/vectors/search returns semantic matches and validates query', async () => {
    // Populate vectors directly
    await harness.memory.vector.store({ content: 'apple banana cherry', metadata: {} });
    await harness.memory.vector.store({ content: 'banana cherry dragonfruit', metadata: {} });
    await harness.memory.vector.store({ content: 'zebra quokka marsupial', metadata: {} });

    const ok = await harness.app.inject({
      method: 'GET',
      url: '/api/memory/vectors/search?q=apple&topK=2',
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(body.ok).toBe(true);
    expect(body.data.query).toBe('apple');
    expect(body.data.total).toBeLessThanOrEqual(2);
    // Top result should be the one with "apple"
    expect(body.data.results[0].content).toContain('apple');

    // Empty q fails schema validation
    const bad = await harness.app.inject({ method: 'GET', url: '/api/memory/vectors/search' });
    expect(bad.statusCode).toBe(400);
  });

  it('DELETE /api/memory/vectors/:id removes a vector entry', async () => {
    const id = await harness.memory.vector.store({ content: 'temporary', metadata: {} });
    expect(harness.memory.vector.size).toBe(1);

    const ok = await harness.app.inject({ method: 'DELETE', url: `/api/memory/vectors/${id}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.deleted).toBe(id);
    expect(harness.memory.vector.size).toBe(0);

    const missing = await harness.app.inject({ method: 'DELETE', url: '/api/memory/vectors/nonexistent' });
    expect(missing.statusCode).toBe(404);
  });

  it('GET /api/memory/stats reflects data added via remember()', async () => {
    await harness.memory.session.create('s1', { userId: 'u1', channelId: 'c1', agentId: 'a1' });
    await harness.memory.remember('s1', makeMessage('m1', 'user', 'remembered fact', Date.now()), {
      storeVector: true,
    });

    const res = await harness.app.inject({ method: 'GET', url: '/api/memory/stats' });
    const body = res.json();
    expect(body.data.sessions.active).toBe(1);
    expect(body.data.vectors.total).toBe(1);
  });
});
