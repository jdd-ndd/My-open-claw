/**
 * 三端会话同步功能验证脚本
 *
 * 模拟 web / tui_python / cli 三个客户端同时在线：
 *   1. 三端分别用各自的 userId 建立 WebSocket 连接（共享 channelId='myopenclaw'）
 *   2. 三端各自订阅 chat.* / session.* 等所有事件
 *   3. 通过 REST API 模拟"web 端创建会话"、"tui_python 端发送消息"、"cli 端删除会话"
 *   4. 观察其他端是否收到对应的实时推送
 *   5. 给出三端同步能力的完整诊断报告
 *
 * 用法：node scripts/verify-cross-client-sync.mjs
 */

import { randomUUID } from 'crypto';

// ============================================================
// 配置
// ============================================================
const GATEWAY_HTTP = 'http://127.0.0.1:18780/api';
const GATEWAY_WS = 'ws://127.0.0.1:18780/ws';
const SHARED_CHANNEL_ID = 'myopenclaw';
const TIMEOUT_MS = 90_000;

// 三端标识（统一共享 channelId，但各自独立 userId 以区分连接）
const CLIENTS = [
  { name: 'web',         userId: 'shared-user' },        // web 端默认 userId
  { name: 'tui_python',  userId: 'default-user' },       // tui_python 端默认 userId
  { name: 'cli',         userId: 'cli-user' },           // cli 端默认 userId
];

// ============================================================
// 工具
// ============================================================
const color = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', blue: '\x1b[34m', gray: '\x1b[90m',
};

let pass = 0;
let fail = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ${color.green}✓${color.reset} ${name}${detail ? ' ' + color.dim + detail + color.reset : ''}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ${color.red}✗${color.reset} ${name}${detail ? ' ' + color.red + detail + color.reset : ''}`);
  }
}

async function apiGet(path) {
  const resp = await fetch(`${GATEWAY_HTTP}${path}`);
  const json = await resp.json().catch(() => ({}));
  return { status: resp.status, body: json };
}

async function apiPost(path, body) {
  const resp = await fetch(`${GATEWAY_HTTP}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  return { status: resp.status, body: json };
}

async function apiDelete(path) {
  const resp = await fetch(`${GATEWAY_HTTP}${path}`, { method: 'DELETE' });
  const json = await resp.json().catch(() => ({}));
  return { status: resp.status, body: json };
}

async function apiPatch(path, body) {
  const resp = await fetch(`${GATEWAY_HTTP}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  return { status: resp.status, body: json };
}

// ============================================================
// 模拟客户端类
// ============================================================
class SimClient {
  constructor(name, userId) {
    this.name = name;
    this.userId = userId;
    this.ws = null;
    this.connected = false;
    /** 收到的所有事件，按类型分类 */
    this.events = {
      chat: [],         // chat.delta / chat.done / chat.error / chat.reasoning_delta
      session: [],      // session.created / updated / deleted / changed（如果存在）
      response: [],     // 路由响应
      other: [],
    };
    this.bindPromise = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(GATEWAY_WS);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error(`${this.name} 连接超时`)), 10_000);

      ws.addEventListener('open', () => {
        clearTimeout(timer);
        this.connected = true;
        // 发送 ping 带认证信息
        ws.send(JSON.stringify({
          type: 'request',
          id: randomUUID(),
          requestId: randomUUID(),
          timestamp: new Date().toISOString(),
          action: 'ping',
          payload: {
            channelId: SHARED_CHANNEL_ID,
            userId: this.userId,
          },
        }));
        resolve();
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        this.handleMessage(msg);
      });

      ws.addEventListener('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`${this.name} WebSocket 错误: ${err.message || 'unknown'}`));
      });

      ws.addEventListener('close', () => {
        this.connected = false;
      });
    });
  }

  handleMessage(msg) {
    if (msg.type === 'response') {
      this.events.response.push(msg);
    } else if (msg.type === 'event') {
      const eventName = msg.event || '';
      if (eventName.startsWith('chat.')) {
        this.events.chat.push(msg);
      } else if (eventName.startsWith('session.')) {
        this.events.session.push(msg);
        console.log(`  ${color.magenta}[${this.name}]${color.reset} 收到 ${color.cyan}${eventName}${color.reset} 事件`);
      } else {
        this.events.other.push(msg);
      }
    }
  }

  /** 绑定到指定会话 */
  async bindSession(sessionId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.name} bind 超时`)), 5000);
      const id = randomUUID();
      const onMessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type === 'response' && msg.requestId === id) {
          clearTimeout(timer);
          this.ws.removeEventListener('message', onMessage);
          resolve(msg);
        }
      };
      this.ws.addEventListener('message', onMessage);
      this.ws.send(JSON.stringify({
        type: 'request',
        id,
        requestId: id,
        timestamp: new Date().toISOString(),
        action: 'session.bind',
        payload: {
          sessionId,
          channelId: SHARED_CHANNEL_ID,
          userId: this.userId,
        },
      }));
    });
  }

  /** 发送聊天消息 */
  async sendChat(sessionId, content) {
    const id = randomUUID();
    return new Promise((resolve) => {
      this.ws.send(JSON.stringify({
        type: 'request',
        id,
        requestId: id,
        timestamp: new Date().toISOString(),
        action: 'chat.send',
        payload: {
          sessionId,
          messageId: randomUUID(),
          content,
          channelId: SHARED_CHANNEL_ID,
          userId: this.userId,
        },
      }));
      // 不等回复，调用方负责监听事件
      resolve();
    });
  }

  close() {
    if (this.ws && this.connected) {
      this.ws.close();
    }
  }
}

// ============================================================
// 测试流程
// ============================================================

async function main() {
  console.log(color.bold + color.cyan);
  console.log('╔' + '═'.repeat(62) + '╗');
  console.log('║  三端会话同步功能完整测试 — web / tui_python / cli          ║');
  console.log('╚' + '═'.repeat(62) + '╝');
  console.log(color.reset);

  // ── 1. 健康检查 ──
  console.log(color.bold + '\n[1/6] 网关健康检查' + color.reset);
  const health = await apiGet('/health');
  check('网关可达', health.status === 200, `status=${health.body?.data?.status}`);
  if (health.status !== 200) {
    console.log(color.red + '  网关未启动，终止测试' + color.reset);
    process.exit(1);
  }

  // ── 2. 三端同时连接 WebSocket ──
  console.log(color.bold + '\n[2/6] 三端 WebSocket 连接' + color.reset);
  const clients = CLIENTS.map((c) => new SimClient(c.name, c.userId));
  for (const c of clients) {
    try {
      await c.connect();
      check(`${c.name} WebSocket 连接成功`, c.connected);
    } catch (e) {
      check(`${c.name} WebSocket 连接成功`, false, e.message);
    }
  }

  // ── 3. web 端创建会话，观察其他端是否收到 session.created 事件 ──
  console.log(color.bold + '\n[3/6] web 端通过 REST 创建会话，观察其他端是否收到事件' + color.reset);
  const sessionTitle = `cross-sync-test-${Date.now()}`;
  const createResp = await apiPost('/sessions', {
    agentId: 'jarvis',
    channelId: SHARED_CHANNEL_ID,
    userId: clients[0].userId,
    title: sessionTitle,
  });
  // 注意：API 返回的字段名是 sessionId 而非 id
  const sessionId = createResp.body?.data?.sessionId ?? createResp.body?.data?.id;
  check('web 端创建会话成功', createResp.status === 200 && !!sessionId,
    `sessionId=${sessionId}`);

  if (sessionId) {
    // 等待 1 秒，给服务器时间推送事件
    await sleep(1000);
    check('tui_python 端收到 session.created 事件', clients[1].events.session.length > 0,
      `收到 ${clients[1].events.session.length} 个 session 事件`);
    check('cli 端收到 session.created 事件', clients[2].events.session.length > 0,
      `收到 ${clients[2].events.session.length} 个 session 事件`);
  }

  // ── 4. 三端绑定到同一会话，验证 chat.* 广播 ──
  console.log(color.bold + '\n[4/6] 三端绑定会话，验证 chat.* 跨端广播' + color.reset);
  if (sessionId) {
    for (const c of clients) {
      try {
        const r = await c.bindSession(sessionId);
        check(`${c.name} session.bind 成功`, r.status === 'success');
      } catch (e) {
        check(`${c.name} session.bind 成功`, false, e.message);
      }
    }

    // 清空之前的 chat 事件
    clients.forEach((c) => (c.events.chat = []));

    // web 端发消息，观察其他端是否收到 chat.delta
    console.log(color.dim + '  web 端发送消息，等待 chat.delta 广播（最多 20s）...' + color.reset);
    await clients[0].sendChat(sessionId, '你好，这是来自 web 端的同步测试消息');

    // 等待 chat.* 事件（LLM 响应可能需要 10s+）
    let waited = 0;
    while (waited < 20000) {
      const anyGot = clients.some((c) => c.events.chat.length > 0);
      if (anyGot) break;
      await sleep(1000);
      waited += 1000;
    }
    if (waited > 0) {
      console.log(color.dim + `  等待 ${waited}ms 后停止等待` + color.reset);
    }

    check('web 端（发送方）收到 chat.* 事件', clients[0].events.chat.length > 0,
      `收到 ${clients[0].events.chat.length} 个`);
    check('tui_python 端收到 chat.* 事件', clients[1].events.chat.length > 0,
      `收到 ${clients[1].events.chat.length} 个`);
    check('cli 端收到 chat.* 事件', clients[2].events.chat.length > 0,
      `收到 ${clients[2].events.chat.length} 个`);
  }

  // ── 5. tui_python 端通过 REST 修改会话标题，观察其他端是否收到 session.updated ──
  console.log(color.bold + '\n[5/6] tui_python 端通过 REST 修改标题，观察事件广播' + color.reset);
  // 清空 session 事件
  clients.forEach((c) => (c.events.session = []));

  if (sessionId) {
    const patchResp = await apiPatch(`/sessions/${sessionId}`, {
      title: `renamed-by-tui-${Date.now()}`,
    });
    check('tui_python 端 PATCH 成功', patchResp.status === 200, `status=${patchResp.status}`);

    await sleep(1000);
    check('web 端收到 session.updated 事件', clients[0].events.session.length > 0,
      `收到 ${clients[0].events.session.length} 个`);
    check('cli 端收到 session.updated 事件', clients[2].events.session.length > 0,
      `收到 ${clients[2].events.session.length} 个`);
  }

  // ── 6. cli 端通过 REST 删除会话，观察其他端是否收到 session.deleted ──
  console.log(color.bold + '\n[6/6] cli 端通过 REST 删除会话，观察事件广播' + color.reset);
  clients.forEach((c) => (c.events.session = []));

  if (sessionId) {
    const delResp = await apiDelete(`/sessions/${sessionId}`);
    check('cli 端 DELETE 成功', delResp.status === 200, `status=${delResp.status}`);

    await sleep(1000);
    check('web 端收到 session.deleted 事件', clients[0].events.session.length > 0,
      `收到 ${clients[0].events.session.length} 个`);
    check('tui_python 端收到 session.deleted 事件', clients[1].events.session.length > 0,
      `收到 ${clients[1].events.session.length} 个`);
  }

  // 清理
  clients.forEach((c) => c.close());

  // 汇总
  console.log('\n' + '═'.repeat(64));
  console.log(color.bold + '  汇总报告' + color.reset);
  console.log('═'.repeat(64));
  console.log(`  通过: ${color.green}${pass}${color.reset}`);
  console.log(`  失败: ${color.red}${fail}${color.reset}`);
  if (failures.length > 0) {
    console.log(`  ${color.red}失败项:${color.reset}`);
    for (const f of failures) console.log(`    - ${f}`);
  }
  console.log(`  整体: ${fail === 0 ? color.green + '✅ 全部通过' : color.red + '❌ 存在失败项'}${color.reset}`);

  process.exit(fail === 0 ? 0 : 1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 总超时
setTimeout(() => {
  console.log(color.red + `\n⏰ 总超时 ${TIMEOUT_MS / 1000}s，强制退出` + color.reset);
  process.exit(2);
}, TIMEOUT_MS);

main().catch((e) => {
  console.error(color.red + `未捕获异常: ${e.message}` + color.reset);
  console.error(e.stack);
  process.exit(1);
});
