import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:18780/ws');

ws.on('open', () => {
  console.log('WebSocket 连接成功');
  ws.send(JSON.stringify({
    id: 'test-1',
    type: 'request',
    action: 'chat.send',
    payload: {
      sessionId: 'test-session',
      content: '你好',
      channelId: 'webchat',
      userId: 'web-user',
    },
    timestamp: new Date().toISOString(),
    requestId: 'test-req-1',
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('收到消息:', JSON.stringify(msg, null, 2));
  if (msg.type === 'event' && msg.event === 'chat.done') {
    ws.close();
  }
});

ws.on('error', (err) => {
  console.error('WebSocket 错误:', err.message);
});

ws.on('close', (code, reason) => {
  console.log('WebSocket 关闭:', code, reason.toString());
  process.exit(0);
});

setTimeout(() => {
  console.log('超时退出');
  process.exit(0);
}, 15000);
