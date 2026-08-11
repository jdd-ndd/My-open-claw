/**
 * P1.3 端到端验证: 通过 WebSocket 发 chat.send, 验证 server 端接受新字段
 *
 * 启动 server 后跑这个脚本:
 *   cd server && pnpm dev
 *   node test-ws-p13.mjs
 *
 * 验证目标:
 * 1. server 接受 workMode / intensity / model 字段 (不报 400)
 * 2. server 收到消息后会构造 LLM 调用, metadata 透传 (从 server log 可观察)
 * 3. workMode=plan 时, orchestrator 注入 Plan 模式提示词
 */
import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:18780/ws');

let messageCount = 0;
let receivedDone = false;

ws.on('open', () => {
  console.log('✓ WebSocket 连接成功');
  // P1.3: 客户端 (TUI) 在 chat.send payload 里加 workMode / intensity / model
  ws.send(JSON.stringify({
    id: 'p13-test-1',
    type: 'request',
    action: 'chat.send',
    payload: {
      sessionId: 'p13-session',
      content: 'P1.3 验证: 简单测试',
      channelId: 'webchat',
      userId: 'p13-user',
      workMode: 'plan',
      intensity: 'low',
      model: 'deepseek-v4-flash',
    },
    timestamp: new Date().toISOString(),
    requestId: 'p13-req-1',
  }));
});

ws.on('message', (data) => {
  messageCount += 1;
  const msg = JSON.parse(data.toString());
  // 简化打印
  const summary = msg.type === 'event'
    ? `event=${msg.event}`
    : msg.type === 'response'
      ? `response status=${msg.status ?? '?'}`
      : `type=${msg.type}`;
  console.log(`  [${messageCount}] ${summary}`);
  if (msg.type === 'response') {
    // chat.send 同步响应: 检查 status
    if (msg.status === 'success') {
      console.log('    payload:', JSON.stringify(msg.payload, null, 2));
    } else {
      console.log('    errorCode:', msg.errorCode, 'errorMessage:', msg.errorMessage);
    }
  }
  if (msg.type === 'event' && msg.event === 'chat.done') {
    receivedDone = true;
    ws.close();
  }
});

ws.on('error', (err) => {
  console.error('✗ WebSocket 错误:', err.message);
});

ws.on('close', (code, reason) => {
  console.log(`\n连接关闭 (code=${code})`);
  console.log(`总共收到 ${messageCount} 条消息, chat.done=${receivedDone}`);
  process.exit(receivedDone ? 0 : 1);
});

setTimeout(() => {
  console.log('\n超时退出 (15s)');
  process.exit(receivedDone ? 0 : 1);
}, 15000);
