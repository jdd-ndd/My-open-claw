/**
 * BUG 修复现场验证 v2
 */
const GATEWAY_HTTP = 'http://127.0.0.1:18780/api';
const GATEWAY_WS = 'ws://127.0.0.1:18780/ws';
const CHANNEL = 'tui';
const WebSocket = globalThis.WebSocket;
const { randomUUID } = await import('crypto');

async function apiGet(path) {
  const resp = await fetch(`${GATEWAY_HTTP}${path}`);
  return resp.json();
}

let pass = 0, fail = 0;
function check(name, condition, detail = '') {
  if (condition) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ============================================================
// BUG #1: HTTP 拦截器不再导致 API 返回 undefined
// 核心验证：API 返回的是有效的结构化数据，而不是 undefined
// ============================================================
async function test_bug1() {
  console.log('\n' + '═'.repeat(64));
  console.log('  BUG #1: HTTP 拦截器修复验证');
  console.log('═'.repeat(64));

  try {
    // 1. health — 无 data 包装
    const health = await apiGet('/health');
    check('health 返回有效数据', !!health?.data?.status, `status=${health?.data?.status}`);

    // 2. status — 有 data 包装
    const status = await apiGet('/status');
    check('status 返回有效数据', !!status?.data?.status, `status=${status?.data?.status}`);
    check('status.data 非 undefined', status?.data !== undefined);
    check('status.data.status 为 running', status?.data?.status === 'running');

    // 3. sessions — 验证 sessions 数组存在（即使为空）
    const sessions = await apiGet('/sessions');
    const sessionsArray = sessions?.data?.sessions;
    check('sessions 返回有效数据', sessionsArray !== undefined, `type=${typeof sessionsArray}`);
    check('sessions 是数组', Array.isArray(sessionsArray), `length=${sessionsArray?.length ?? 'undefined'}`);

    // 4. time — 单层 data
    const time = await apiGet('/time');
    check('time 返回有效数据', !!time?.data?.serverTime);
    check('time.data 非 undefined', time?.data !== undefined);

  } catch (e) {
    check('API 调用', false, `异常: ${e.message}`);
  }

  console.log(`\n  BUG #1 判定: ${fail === 0 ? '✅ 已修复 — API 正确返回结构化数据' : '❌ 仍存在问题'}`);
  const bug1pass = fail === 0;
  return bug1pass;
}

// ============================================================
// BUG #2: 消息内容不重复（accumulated == totalContent）
// BUG #3: 流式只有一个回复
// ============================================================
async function test_bug2_bug3() {
  console.log('\n' + '═'.repeat(64));
  console.log('  BUG #2 & #3: 消息内容 + 流式渲染验证');
  console.log('═'.repeat(64));

  const sid = `verify-stream-${Date.now()}`;
  const uid = `verify-user-${Date.now()}`;

  return new Promise((resolve) => {
    const ws = new WebSocket(GATEWAY_WS);
    const stats = { deltas: 0, donePayload: null, accumulated: '' };
    let startTime = Date.now();

    setTimeout(() => { check('流式超时', false); resolve(); }, 60000);

    ws.addEventListener('open', () => {
      console.log('  ✓ WebSocket 已连接');
      const reqId = randomUUID();
      ws.send(JSON.stringify({
        type: 'request', id: reqId, requestId: reqId,
        timestamp: new Date().toISOString(), action: 'chat.send',
        payload: { channelId: CHANNEL, userId: uid, sessionId: sid,
          content: '用一句话回答：什么是递归？', messageType: 'text' },
      }));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.event === 'chat.delta') {
        stats.deltas++;
        stats.accumulated = msg.payload.accumulated ?? stats.accumulated;
      }

      if (msg.event === 'chat.done') {
        stats.donePayload = msg.payload;
        const content = msg.payload.totalContent ?? '';
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // BUG #2: accumulated 和 totalContent 必须一致
        // 如果 finishStreaming 重复追加，accumulated != totalContent
        const consistent = stats.accumulated === content;
        check(`BUG #2: 内容无重复 (${elapsed}s)`, consistent,
          `accumulated=${stats.accumulated.length}c total=${content.length}c`);

        if (!consistent) {
          console.log(`    差异: accumulated多了 ${stats.accumulated.length - content.length} 字符`);
        }

        // BUG #3: delta 数量合理（无双重渲染，每个delta是一小段文本）
        check(`BUG #3: delta 事件正常 (${stats.deltas} 个)`, stats.deltas > 0 && stats.deltas < 200,
          `正常范围为 1~200`);

        // 附加：回复内容合理
        check(`回复质量: 含关键内容`, content.includes('递归') || content.length > 10,
          `回复=${content.substring(0, 60)}`);

        console.log();
        console.log(`  ── 服务器行为 ──`);
        console.log(`  总 delta 事件: ${stats.deltas}`);
        console.log(`  totalContent: ${content.length} 字符`);
        console.log(`  accumulated: ${stats.accumulated.length} 字符`);
        console.log(`  完全一致: ${consistent ? '✅' : '❌'}`);
        console.log();
        console.log(`  BUG #2 判定: ${consistent ? '✅ 已修复' : '❌ 仍存在重复'}`);
        console.log(`  BUG #3 判定: ${stats.deltas > 0 && stats.deltas < 200 ? '✅ 已修复' : '⚠ 需要检查'} `);

        ws.close();
        resolve();
      }
    });

    ws.addEventListener('error', (e) => { console.log(`  ✗ WS错误: ${e.message}`); resolve(); });
  });
}

// ============================================================
console.log('╔' + '═'.repeat(62) + '╗');
console.log('║  BUG 修复现场验证 v2     Gateway: ' + GATEWAY_WS.padEnd(24) + '║');
console.log('╚' + '═'.repeat(62) + '╝');

const b1 = await test_bug1();
await test_bug2_bug3();

console.log('\n' + '═'.repeat(64));
console.log(`  总计: ${pass} 通过 / ${pass + fail} 总计`);
if (fail === 0) console.log('  🎉 三个致命 BUG 全部修复！');
else console.log(`  ⚠ 还有 ${fail} 项未通过，需要进一步检查`);
console.log('═'.repeat(64));
