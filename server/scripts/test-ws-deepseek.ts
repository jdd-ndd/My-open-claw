/**
 * 快速 WebSocket 端到端测试：验证 TUI → Gateway → AgentBridge → DeepSeek 全链路
 *
 * 用法：npx tsx scripts/test-ws-deepseek.ts
 */

import WebSocket from 'ws';

const WS_URL = 'ws://localhost:18780/ws';

function sendRequest(ws: WebSocket, id: string, content: string) {
  const msg = {
    type: 'request',
    id,
    timestamp: new Date().toISOString(),
    payload: {
      channelId: 'tui',
      userId: 'tui-user',
      content,
      messageType: 'text',
    },
  };
  ws.send(JSON.stringify(msg));
  console.log(`[→] 发送消息: "${content}"`);
}

function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      console.log('[√] WebSocket 已连接\n');
      sendRequest(ws, 'test-1', '你好，请简单介绍你自己');
    });

    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'response') {
        if (msg.status === 'success') {
          console.log(`[√] 路由成功 → agentId: ${msg.payload.agentId}, sessionId: ${msg.payload.sessionId}`);
        } else {
          console.log(`[×] 路由失败: ${msg.errorMessage}`);
        }
      }

      if (msg.type === 'event') {
        if (msg.event === 'chat.delta') {
          accumulated += msg.payload.delta;
          process.stdout.write(msg.payload.delta);
        }
        if (msg.event === 'chat.done') {
          if (msg.payload.error) {
            console.log(`\n\n[×] 错误: ${msg.payload.totalContent}`);
          } else {
            console.log(`\n\n[√] 回复完成 (${msg.payload.durationMs}ms, ${msg.payload.totalContent.length} 字符)`);
            console.log('─'.repeat(60));
            console.log('完整回复:');
            console.log(msg.payload.totalContent);
            console.log('─'.repeat(60));
          }
          ws.close();
          resolve();
        }
      }
    });

    ws.on('error', (err) => {
      console.error('[×] WebSocket 错误:', err.message);
      reject(err);
    });

    ws.on('close', () => {
      console.log('[√] 连接已关闭');
    });

    setTimeout(() => {
      reject(new Error('连接超时(60s)'));
    }, 60000);
  });
}

connect()
  .then(() => {
    console.log('\n✓ DeepSeek 端到端测试通过');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n× 测试失败:', err.message);
    process.exit(1);
  });
