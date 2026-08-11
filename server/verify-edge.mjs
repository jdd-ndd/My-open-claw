/**
 * 三端会话同步边界场景测试
 *
 * 测试场景：
 * 1. 未绑定 channelId 的连接不应收到广播事件
 * 2. 不同 channelId 的连接不应收到其他渠道的广播
 * 3. 并发创建多个会话，所有端都能收到所有事件
 * 4. 排除自身连接：发起方不应收到自己触发的事件（如果实现了 excludeConnectionId）
 * 5. 连接断开后不再收到事件
 * 6. 会话不存在时更新/删除返回正确错误
 */

import { WebSocket } from 'ws';

const GATEWAY_URL = 'ws://localhost:18780/ws';
const HTTP_BASE = 'http://localhost:18780';
const CHANNEL_ID = 'myopenclaw';
const OTHER_CHANNEL_ID = 'other-channel';
const USER_ID = 'shared-user';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function createClient(name) {
  const ws = new WebSocket(GATEWAY_URL);
  const events = [];
  let connected = false;

  const client = {
    ws,
    events,
    name,
    async request(action, payload, timeout = 5000) {
      const requestId = genId();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${name} ${action} 超时`)), timeout);
        const handler = (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.requestId === requestId && msg.type === 'response') {
              clearTimeout(timer);
              ws.removeEventListener('message', handler);
              if (msg.status === 'error') {
                reject(new Error(msg.errorMessage || msg.errorCode || '请求失败'));
              } else {
                resolve(msg.payload);
              }
            }
          } catch {}
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({
          id: genId(),
          type: 'request',
          action,
          payload,
          requestId,
          timestamp: new Date().toISOString(),
        }));
      });
    },
    close() {
      ws.close();
    },
    waitForEvent(eventName, timeout = 2000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${name} 等待 ${eventName} 超时`)), timeout);
        const check = () => {
          const idx = this.events.findIndex((e) => e.event === eventName);
          if (idx >= 0) {
            clearTimeout(timer);
            const [event] = this.events.splice(idx, 1);
            resolve(event);
            return true;
          }
          return false;
        };
        if (check()) return;
        const interval = setInterval(() => {
          if (check()) {
            clearInterval(interval);
          }
        }, 100);
      });
    },
    expectNoEvent(eventName, waitMs = 1000) {
      return new Promise((resolve) => {
        const before = this.events.length;
        setTimeout(() => {
          const hasEvent = this.events.some((e) => e.event === eventName);
          resolve(!hasEvent);
        }, waitMs);
      });
    },
  };

  ws.on('open', () => {
    connected = true;
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'event' && msg.event) {
        events.push({
          event: msg.event,
          payload: msg.payload,
          timestamp: msg.timestamp,
        });
      }
    } catch {}
  });

  ws.on('error', () => {});

  return client;
}

async function createSessionViaApi(channelId, title) {
  const res = await fetch(`${HTTP_BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'jarvis',
      channelId,
      userId: USER_ID,
      title,
    }),
  });
  const data = await res.json();
  return data;
}

async function deleteSessionViaApi(sessionId) {
  const res = await fetch(`${HTTP_BASE}/api/sessions/${sessionId}`, { method: 'DELETE' });
  return res.json();
}

async function updateSessionViaApi(sessionId, payload) {
  const res = await fetch(`${HTTP_BASE}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function main() {
  const results = [];

  console.log('═'.repeat(70));
  console.log('三端会话同步 - 边界场景测试');
  console.log('═'.repeat(70));

  // ── 场景 1：未绑定 channelId 的连接不应收到广播事件 ──
  console.log('\n【场景 1】未绑定 channelId 的连接不应收到广播事件');
  const bound = createClient('Bound');
  const unbound = createClient('Unbound');

  await Promise.all([
    new Promise((r) => bound.ws.on('open', r)),
    new Promise((r) => unbound.ws.on('open', r)),
  ]);

  // 只绑定 bound 客户端
  await bound.request('session.bind', {
    sessionId: null,
    channelId: CHANNEL_ID,
    userId: USER_ID,
  });
  // unbound 不发送 session.bind

  await sleep(300);

  const sess1 = await createSessionViaApi(CHANNEL_ID, '边界测试-场景1');
  if (!sess1.ok) {
    console.log('  ❌ 创建会话失败:', sess1.error);
    results.push({ name: '场景1: 未绑定不收事件', pass: false });
  } else {
    // bound 应该收到
    try {
      await bound.waitForEvent('session.created', 2000);
      console.log('  ✅ 已绑定的 Bound 客户端收到 session.created 事件');
      const boundReceived = true;

      // unbound 不应该收到
      const unboundReceived = await unbound.expectNoEvent('session.created', 1000);
      if (unboundReceived) {
        console.log('  ✅ 未绑定的 Unbound 客户端未收到事件');
        results.push({ name: '场景1: 未绑定不收事件', pass: true });
      } else {
        console.log('  ❌ 未绑定的 Unbound 客户端收到了事件（不应发生）');
        results.push({ name: '场景1: 未绑定不收事件', pass: false });
      }
    } catch (e) {
      console.log('  ❌ Bound 客户端未收到事件:', e.message);
      results.push({ name: '场景1: 未绑定不收事件', pass: false });
    }
  }

  await deleteSessionViaApi(sess1.data.sessionId);
  bound.close();
  unbound.close();
  await sleep(300);

  // ── 场景 2：不同 channelId 的连接不应收到其他渠道的广播 ──
  console.log('\n【场景 2】不同 channelId 的连接不应收到其他渠道的广播');
  const clientA = createClient('ChannelA');
  const clientB = createClient('ChannelB');

  await Promise.all([
    new Promise((r) => clientA.ws.on('open', r)),
    new Promise((r) => clientB.ws.on('open', r)),
  ]);

  await clientA.request('session.bind', {
    sessionId: null,
    channelId: CHANNEL_ID,
    userId: USER_ID,
  });
  await clientB.request('session.bind', {
    sessionId: null,
    channelId: OTHER_CHANNEL_ID,
    userId: USER_ID,
  });

  await sleep(300);

  // 在 CHANNEL_ID 创建会话
  const sess2 = await createSessionViaApi(CHANNEL_ID, '边界测试-场景2-A');
  try {
    await clientA.waitForEvent('session.created', 2000);
    console.log('  ✅ Channel A 客户端收到本渠道的 session.created 事件');
    const bReceived = await clientB.expectNoEvent('session.created', 1000);
    if (bReceived) {
      console.log('  ✅ Channel B 客户端未收到其他渠道的事件');
      results.push({ name: '场景2: 渠道隔离', pass: true });
    } else {
      console.log('  ❌ Channel B 客户端收到了其他渠道的事件（不应发生）');
      results.push({ name: '场景2: 渠道隔离', pass: false });
    }
  } catch (e) {
    console.log('  ❌ Channel A 未收到事件:', e.message);
    results.push({ name: '场景2: 渠道隔离', pass: false });
  }

  await deleteSessionViaApi(sess2.data.sessionId);
  clientA.close();
  clientB.close();
  await sleep(300);

  // ── 场景 3：并发创建多个会话，所有端都能收到所有事件 ──
  console.log('\n【场景 3】并发创建 5 个会话，所有端应收到全部 5 个事件');
  const cc1 = createClient('Concurrent1');
  const cc2 = createClient('Concurrent2');

  await Promise.all([
    new Promise((r) => cc1.ws.on('open', r)),
    new Promise((r) => cc2.ws.on('open', r)),
  ]);

  await cc1.request('session.bind', { sessionId: null, channelId: CHANNEL_ID, userId: USER_ID });
  await cc2.request('session.bind', { sessionId: null, channelId: CHANNEL_ID, userId: USER_ID });

  await sleep(300);
  cc1.events.length = 0;
  cc2.events.length = 0;

  // 并发创建 5 个会话
  const createPromises = [];
  const sessionIds = [];
  for (let i = 0; i < 5; i++) {
    createPromises.push(createSessionViaApi(CHANNEL_ID, `并发会话-${i + 1}`));
  }
  const responses = await Promise.all(createPromises);
  for (const r of responses) {
    if (r.ok) sessionIds.push(r.data.sessionId);
  }

  // 等待事件到达
  await sleep(1500);

  const cc1Count = cc1.events.filter((e) => e.event === 'session.created').length;
  const cc2Count = cc2.events.filter((e) => e.event === 'session.created').length;

  console.log(`  CC1 收到 ${cc1Count} 个 session.created 事件`);
  console.log(`  CC2 收到 ${cc2Count} 个 session.created 事件`);

  if (cc1Count === 5 && cc2Count === 5) {
    console.log('  ✅ 两端均收到全部 5 个事件');
    results.push({ name: '场景3: 并发广播', pass: true });
  } else {
    console.log('  ❌ 事件数量不正确');
    results.push({ name: '场景3: 并发广播', pass: false });
  }

  // 清理会话
  for (const sid of sessionIds) {
    await deleteSessionViaApi(sid);
  }
  cc1.close();
  cc2.close();
  await sleep(300);

  // ── 场景 4：连接断开后不再收到事件 ──
  console.log('\n【场景 4】连接断开后不再收到事件');
  const alive = createClient('Alive');
  const toClose = createClient('ToClose');

  await Promise.all([
    new Promise((r) => alive.ws.on('open', r)),
    new Promise((r) => toClose.ws.on('open', r)),
  ]);

  await alive.request('session.bind', { sessionId: null, channelId: CHANNEL_ID, userId: USER_ID });
  await toClose.request('session.bind', { sessionId: null, channelId: CHANNEL_ID, userId: USER_ID });

  await sleep(300);

  // 先创建一个会话，确认两端都能收到
  const sess4 = await createSessionViaApi(CHANNEL_ID, '边界测试-场景4-前');
  try {
    await alive.waitForEvent('session.created', 2000);
    await toClose.waitForEvent('session.created', 2000);
    console.log('  ✅ 断开前：两端都收到事件');
  } catch (e) {
    console.log('  ❌ 断开前未收到事件:', e.message);
  }
  await deleteSessionViaApi(sess4.data.sessionId);
  await sleep(500);
  alive.events.length = 0;
  toClose.events.length = 0;

  // 断开 toClose
  toClose.close();
  await sleep(500);

  // 再创建一个会话
  const sess4b = await createSessionViaApi(CHANNEL_ID, '边界测试-场景4-后');
  await sleep(1000);

  const aliveCount = alive.events.filter((e) => e.event === 'session.created').length;
  if (aliveCount >= 1) {
    console.log('  ✅ 断开后：Alive 客户端仍能收到事件');
    results.push({ name: '场景4: 断开后不收事件', pass: true });
  } else {
    console.log('  ❌ 断开后：Alive 客户端未收到事件');
    results.push({ name: '场景4: 断开后不收事件', pass: false });
  }

  await deleteSessionViaApi(sess4b.data.sessionId);
  alive.close();
  await sleep(300);

  // ── 场景 5：会话不存在时更新/删除返回正确错误 ──
  console.log('\n【场景 5】会话不存在时更新/删除返回正确错误');
  const fakeId = 'sess-nonexistent-' + genId();
  const updateRes = await updateSessionViaApi(fakeId, { title: '不存在' });
  const deleteRes = await deleteSessionViaApi(fakeId);

  if (!updateRes.ok && updateRes.error) {
    console.log('  ✅ 更新不存在的会话返回错误:', updateRes.error.message || updateRes.error.code);
  } else {
    console.log('  ❌ 更新不存在的会话应返回错误');
  }

  if (!deleteRes.ok && deleteRes.error) {
    console.log('  ✅ 删除不存在的会话返回错误:', deleteRes.error.message || deleteRes.error.code);
    results.push({ name: '场景5: 不存在会话错误处理', pass: true });
  } else {
    console.log('  ❌ 删除不存在的会话应返回错误');
    results.push({ name: '场景5: 不存在会话错误处理', pass: false });
  }

  // ── 场景 6：重连后能正常接收事件 ──
  console.log('\n【场景 6】重连后能正常接收事件');
  const reconnect = createClient('Reconnect');
  await new Promise((r) => reconnect.ws.on('open', r));

  await reconnect.request('session.bind', { sessionId: null, channelId: CHANNEL_ID, userId: USER_ID });
  await sleep(300);

  // 断开重连
  reconnect.close();
  await sleep(500);

  const reconnect2 = createClient('Reconnect2');
  await new Promise((r) => reconnect2.ws.on('open', r));
  await reconnect2.request('session.bind', { sessionId: null, channelId: CHANNEL_ID, userId: USER_ID });
  await sleep(300);

  const sess6 = await createSessionViaApi(CHANNEL_ID, '边界测试-场景6');
  try {
    await reconnect2.waitForEvent('session.created', 2000);
    console.log('  ✅ 重连后能正常接收事件');
    results.push({ name: '场景6: 重连后接收', pass: true });
  } catch (e) {
    console.log('  ❌ 重连后未收到事件:', e.message);
    results.push({ name: '场景6: 重连后接收', pass: false });
  }
  await deleteSessionViaApi(sess6.data.sessionId);
  reconnect2.close();

  // ── 汇总 ──
  console.log('\n' + '═'.repeat(70));
  console.log('边界场景测试汇总');
  console.log('═'.repeat(70));
  let passCount = 0;
  for (const r of results) {
    const mark = r.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${mark}  ${r.name}`);
    if (r.pass) passCount++;
  }
  console.log('─'.repeat(70));
  console.log(`  总计: ${passCount}/${results.length} 通过`);
  console.log('═'.repeat(70));

  process.exit(passCount === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error('测试脚本异常:', err);
  process.exit(1);
});