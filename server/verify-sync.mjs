/**
 * 三端会话同步验证脚本
 *
 * 模拟 Web、TUI Python、CLI 三端连接，验证：
 * 1. Web 端创建会话 → TUI/CLI 端收到 session.created 事件
 * 2. TUI 端修改会话 → Web/CLI 端收到 session.updated 事件
 * 3. CLI 端删除会话 → Web/TUI 端收到 session.deleted 事件
 */

import { WebSocket } from 'ws';

const GATEWAY_URL = 'ws://localhost:18780/ws';
const CHANNEL_ID = 'myopenclaw';
const USER_ID = 'shared-user';

/** 等待指定毫秒数 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 生成唯一 ID */
function genId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * 创建一个模拟客户端连接
 * @param {string} name 客户端名称
 * @returns {{ ws: WebSocket, events: Array, send: Function, request: Function, close: Function }}
 */
function createClient(name) {
  const ws = new WebSocket(GATEWAY_URL);
  const events = [];
  let connected = false;

  const client = {
    ws,
    events,
    name,
    async send(action, payload) {
      if (!connected) {
        await new Promise((resolve) => ws.on('open', resolve));
      }
      ws.send(JSON.stringify({
        id: genId(),
        type: 'request',
        action,
        payload,
        timestamp: new Date().toISOString(),
      }));
    },
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
    waitForEvent(eventName, timeout = 5000) {
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
            clearInterval(timer);
            clearTimeout(timer);
            clearInterval(interval);
          }
        }, 100);
      });
    },
  };

  ws.on('open', () => {
    connected = true;
    console.log(`[${name}] WebSocket 已连接`);
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
        console.log(`[${name}] 收到事件: ${msg.event}`);
      }
    } catch (e) {
      console.error(`[${name}] 消息解析失败:`, e.message);
    }
  });

  ws.on('error', (err) => {
    console.error(`[${name}] WebSocket 错误:`, err.message);
  });

  return client;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('三端会话同步功能验证');
  console.log('═'.repeat(60));

  // 创建三个模拟客户端，代表 Web、TUI Python、CLI 三端
  const web = createClient('Web');
  const tui = createClient('TUI');
  const cli = createClient('CLI');

  // 等待所有连接建立
  await Promise.all([
    new Promise((resolve) => web.ws.on('open', resolve)),
    new Promise((resolve) => tui.ws.on('open', resolve)),
    new Promise((resolve) => cli.ws.on('open', resolve)),
  ]);
  console.log('\n✅ 三端均已连接\n');

  // 步骤 1：发送 session.bind，绑定 channelId/userId
  console.log('─'.repeat(60));
  console.log('步骤 1：绑定 channelId/userId');

  await web.request('session.bind', {
    sessionId: null,
    channelId: CHANNEL_ID,
    userId: USER_ID,
  });
  console.log('[Web] session.bind 成功');

  await tui.request('session.bind', {
    sessionId: null,
    channelId: CHANNEL_ID,
    userId: USER_ID,
  });
  console.log('[TUI] session.bind 成功');

  await cli.request('session.bind', {
    sessionId: null,
    channelId: CHANNEL_ID,
    userId: USER_ID,
  });
  console.log('[CLI] session.bind 成功');

  await sleep(500); // 等待绑定生效

  // 步骤 2：Web 端创建会话（通过 REST API）
  console.log('\n' + '─'.repeat(60));
  console.log('步骤 2：Web 端创建会话（通过 REST API）');

  const createResponse = await fetch('http://localhost:18780/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentId: 'jarvis',
      channelId: CHANNEL_ID,
      userId: USER_ID,
      title: '同步测试会话',
    }),
  });

  const createData = await createResponse.json();
  if (!createData.ok) {
    console.error('❌ 创建会话失败:', createData.error);
    process.exit(1);
  }
  const sessionId = createData.data.sessionId;
  console.log(`✅ Web 端创建会话成功: ${sessionId}`);

  // 等待 TUI 和 CLI 端收到 session.created 事件
  console.log('\n等待 TUI 和 CLI 端接收 session.created 事件...');
  try {
    const tuiCreated = await tui.waitForEvent('session.created', 3000);
    console.log(`✅ [TUI] 收到 session.created 事件: ${tuiCreated.payload?.session?.title}`);
  } catch (e) {
    console.log(`❌ [TUI] 未收到 session.created 事件: ${e.message}`);
  }

  try {
    const cliCreated = await cli.waitForEvent('session.created', 3000);
    console.log(`✅ [CLI] 收到 session.created 事件: ${cliCreated.payload?.session?.title}`);
  } catch (e) {
    console.log(`❌ [CLI] 未收到 session.created 事件: ${e.message}`);
  }

  // 步骤 3：TUI 端更新会话标题
  console.log('\n' + '─'.repeat(60));
  console.log('步骤 3：TUI 端修改会话标题');

  const updateResponse = await fetch(`http://localhost:18780/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '已修改的会话标题' }),
  });

  const updateData = await updateResponse.json();
  if (!updateData.ok) {
    console.error('❌ 更新会话失败:', updateData.error);
  } else {
    console.log(`✅ TUI 端更新会话成功`);
  }

  // 等待 Web 和 CLI 端收到 session.updated 事件
  console.log('\n等待 Web 和 CLI 端接收 session.updated 事件...');
  try {
    const webUpdated = await web.waitForEvent('session.updated', 3000);
    console.log(`✅ [Web] 收到 session.updated 事件`);
  } catch (e) {
    console.log(`❌ [Web] 未收到 session.updated 事件: ${e.message}`);
  }

  try {
    const cliUpdated = await cli.waitForEvent('session.updated', 3000);
    console.log(`✅ [CLI] 收到 session.updated 事件`);
  } catch (e) {
    console.log(`❌ [CLI] 未收到 session.updated 事件: ${e.message}`);
  }

  // 步骤 4：CLI 端删除会话
  console.log('\n' + '─'.repeat(60));
  console.log('步骤 4：CLI 端删除会话');

  const deleteResponse = await fetch(`http://localhost:18780/api/sessions/${sessionId}`, {
    method: 'DELETE',
  });

  const deleteData = await deleteResponse.json();
  if (!deleteData.ok) {
    console.error('❌ 删除会话失败:', deleteData.error);
  } else {
    console.log(`✅ CLI 端删除会话成功`);
  }

  // 等待 Web 和 TUI 端收到 session.deleted 事件
  console.log('\n等待 Web 和 TUI 端接收 session.deleted 事件...');
  try {
    const webDeleted = await web.waitForEvent('session.deleted', 3000);
    console.log(`✅ [Web] 收到 session.deleted 事件`);
  } catch (e) {
    console.log(`❌ [Web] 未收到 session.deleted 事件: ${e.message}`);
  }

  try {
    const tuiDeleted = await tui.waitForEvent('session.deleted', 3000);
    console.log(`✅ [TUI] 收到 session.deleted 事件`);
  } catch (e) {
    console.log(`❌ [TUI] 未收到 session.deleted 事件: ${e.message}`);
  }

  // 汇总
  console.log('\n' + '═'.repeat(60));
  console.log('验证完成！');
  console.log('═'.repeat(60));

  // 清理
  web.close();
  tui.close();
  cli.close();
  console.log('\n已关闭所有客户端连接');
}

main().catch((err) => {
  console.error('测试脚本异常:', err);
  process.exit(1);
});