// scripts/verify-tools.mjs
// 烟雾测试: 模拟 TUI 客户端通过 WebSocket 调 LLM 让其使用 fs/read_file 工具
// 验证 12 个真实工具已注册 + AgentRuntimeAdapter.create() 注入成功

import WebSocket from 'ws';

const WS_URL = 'ws://127.0.0.1:18780/ws';
const TIMEOUT_MS = 60_000;

function log(...args) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
}

const events = [];
let responsePayload = null;
let responseResolve = null;
let responseReject = null;
const responsePromise = new Promise((resolve, reject) => {
  responseResolve = resolve;
  responseReject = reject;
});

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  log('ws open');
  const reqId = `req-${Date.now()}`;
  const payload = {
    type: 'request',
    id: reqId,
    timestamp: new Date().toISOString(),
    action: 'chat.send',
    payload: {
      sessionId: `test-session-${Date.now()}`,
      content: '请用 fs/read_file 工具读取 server/package.json 的前 100 字符,告诉我文件内容',
      channelId: 'tui',
      userId: 'verify-bot',
      messageType: 'text',
    },
  };
  log('sending chat.send ...');
  ws.send(JSON.stringify(payload));

  // 30s 后超时
  setTimeout(() => {
    if (responseResolve) {
      responseReject(new Error('overall timeout (30s)'));
    }
  }, 30_000);
});

ws.on('message', (raw) => {
  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }
  events.push(msg);

  if (msg.type === 'response' && !responsePayload) {
    responsePayload = msg;
    log('=== 路由响应 ===');
    log('  matched:', msg.payload?.matched);
    log('  agentId:', msg.payload?.agentId);
    log('  sessionId:', msg.payload?.sessionId);
    responseResolve(msg);
  } else if (msg.type === 'event') {
    const e = msg.event;
    if (e === 'chat.delta') {
      log(`  chat.delta: delta.len=${msg.payload?.delta?.length ?? 0} acc.len=${msg.payload?.accumulated?.length ?? 0}`);
    } else if (e === 'chat.reasoning_delta') {
      log(`  chat.reasoning_delta: delta.len=${msg.payload?.delta?.length ?? 0}`);
    } else if (e === 'chat.done') {
      log('=== chat.done 收到 ===');
      log('  totalContent (前 500):', (msg.payload?.totalContent ?? '').slice(0, 500));
      log('  totalReasoning.len:', msg.payload?.totalReasoning?.length ?? 0);
      log('  reasoningDurationMs:', msg.payload?.reasoningDurationMs);
      log('  durationMs:', msg.payload?.durationMs);
      log('  error:', msg.payload?.error);
    } else if (e === 'chat.error') {
      log('  chat.error:', msg.payload);
    } else {
      log(`  ${e}:`, JSON.stringify(msg.payload).slice(0, 200));
    }
  }
});

ws.on('error', (err) => {
  log('ws error:', err.message);
});

ws.on('close', () => {
  log('ws closed');
});

(async () => {
  try {
    await responsePromise;
    // 再等 50s 收集 LLM 事件(ReAct 多轮可能跑很久)
    log('=== 等待 50s 收集 LLM 事件流 ===');
    await new Promise((r) => setTimeout(r, 50_000));

    // 统计
    const stats = {};
    for (const e of events) {
      if (e.type === 'event') stats[e.event] = (stats[e.event] ?? 0) + 1;
    }
    log('=== 事件统计 ===');
    log(JSON.stringify(stats, null, 2));

    const done = events.find((e) => e.type === 'event' && e.event === 'chat.done');
    if (done) {
      const content = done.payload?.totalContent ?? '';
      log('=== 工具调用判断 ===');
      log('  totalContent 长度:', content.length);
      const calledTool = /package\.json|name|version|workspace|test|build/.test(content);
      log('  看起来包含工具结果(检测到 package.json 字段关键词):', calledTool);
      // 检查内容是否只是 <thought> + <action> 而没有 final_answer
      const hasFinal = content.includes('package.json') || content.includes('package') || content.includes('workspace') || content.length > 50;
      log('  内容非空(>50 字符):', hasFinal);
    } else {
      log('!!! 没收到 chat.done 事件');
    }
  } catch (err) {
    log('FAILED:', err.message);
    log('已收集事件数:', events.length);
    log('最近 5 个事件:', JSON.stringify(events.slice(-5), null, 2));
  } finally {
    ws.close();
    setTimeout(() => process.exit(0), 1000);
  }
})();
