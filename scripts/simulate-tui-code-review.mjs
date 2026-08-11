/**
 * 模拟 TUI 交互会话 — 验证代码审查技能
 * 
 * 模拟流程：连接 WebSocket → 创建会话 → 发送代码审查请求 → 接收流式回复
 */

import { randomUUID } from 'crypto';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

// 使用 Node.js 内置 WebSocket API (v20+)
const WebSocket = globalThis.WebSocket;

// ============================================================
// 配置
// ============================================================
const GATEWAY = 'ws://127.0.0.1:18780/ws';
const CHANNEL = 'tui';          // 模拟 TUI 渠道
const USER_ID = `tui-reviewer-${Date.now()}`;
const SESSION_ID = `tui-code-review-${Date.now()}`;
const TIMEOUT_MS = 120_000;     // 2 分钟超时

// ============================================================
// 步骤 1: 创建用于审查的临时代码文件
// ============================================================
const tmpDir = mkdtempSync(`${tmpdir()}/code-review-`);
const reviewFile = `${tmpDir}/bad_code.mjs`;
writeFileSync(reviewFile, `// 待审查的示例代码 — 包含多种代码质量问题
// 文件路径: ${reviewFile}

var userName = "admin";            // 问题1: 使用 var（应使用 const）
var userAge = "25";                // 问题2: 年龄用字符串（应为 number）

function processData(input) {      // 问题3: 缺少类型/参数校验
  eval("var result = " + input);   // 问题4: 使用 eval（严重安全风险）
  return result;
}

function getPassword() {           // 问题5: 硬编码密码
  return "admin123";               // 问题6: 明文硬编码密码
}

function divide(a, b) {
  return a / b;                    // 问题7: 未检查除零
}

// 问题8: 未使用的变量
const unusedVar = "i am never used";

// 问题9: 深层嵌套（可读性差）
function deepNesting(items) {
  items.forEach((item) => {
    if (item.active) {
      if (item.role === 'admin') {
        if (item.permissions.includes('write')) {
          console.log('admin can write');
        }
      }
    }
  });
}

// 问题10: 缺少分号（不一致的代码风格）
const value = 42
console.log("Value is " + value);  // 问题11: 使用 console.log（应使用日志库）

export { processData, getPassword, divide, deepNesting };
`);

console.log(`✓ 临时审查文件已创建: ${reviewFile}`);

// ============================================================
// 步骤 2: 连接 WebSocket 并发送审查请求
// ============================================================
const ws = new WebSocket(GATEWAY);
const startTime = Date.now();
let messageCount = 0;

ws.addEventListener('open', () => {
  console.log('✓ WebSocket 连接已建立\n');
  console.log('━'.repeat(64));
  console.log(`  模拟 TUI 代码审查会话`);
  console.log(`  会话ID: ${SESSION_ID}`);
  console.log(`  渠道: ${CHANNEL}`);
  console.log(`  审查文件: ${reviewFile}`);
  console.log('━'.repeat(64));
  console.log();

  // 发送聊天消息（代码审查请求）
  const request = {
    type: 'request',
    id: randomUUID(),
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    action: 'chat.send',
    payload: {
      channelId: CHANNEL,
      userId: USER_ID,
      sessionId: SESSION_ID,
      content: `请使用代码审查技能审查以下文件: ${reviewFile}`,
      messageType: 'text',
    },
  };

  console.log('> 发送: ' + request.payload.content);
  console.log();
  ws.send(JSON.stringify(request));
});

ws.addEventListener('message', (event) => {
  const data = event.data;
  let msg;

  try {
    msg = JSON.parse(data);
  } catch {
    console.log(`[原始消息] ${data.substring(0, 200)}`);
    return;
  }

  messageCount++;

  switch (msg.type) {
    case 'response':
      if (msg.status === 'success') {
        console.log(`✓ 路由匹配成功 (${msg.payload.agentId ?? 'default'}, session: ${msg.payload.sessionId})`);
        console.log();
        console.log('━'.repeat(64));
        console.log('  Agent 思考中，等待审查结果...');
        console.log('━'.repeat(64));
        console.log();
      } else if (msg.status === 'error') {
        console.log(`✗ 路由错误: ${msg.errorMessage}`);
      }
      break;

    case 'event': {
      if (msg.event === 'chat.delta') {
        // 流式输出：逐字显示审查内容（字段名为 delta）
        process.stdout.write(msg.payload.delta ?? '');
      } else if (msg.event === 'chat.done') {
        // 审查完成
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log();
        console.log();
        console.log('━'.repeat(64));
        console.log(`  审查完成 ✓ 耗时 ${elapsed}s | 收到 ${messageCount} 条消息`);
        console.log('━'.repeat(64));
        ws.close();
      } else if (msg.event === 'chat.reasoning') {
        // Agent 思考过程（折叠显示）
        const content = msg.payload.content ?? '';
        process.stdout.write(`\x1b[90m[思考] ${content.substring(0, 120)}...\x1b[0m\n`);
      }
      break;
    }

    case 'response': {
      // 非路由响应
      break;
    }

    default:
      // 忽略其他消息类型
      break;
  }
});

ws.addEventListener('error', (err) => {
  console.error(`✗ WebSocket 错误: ${err.message}`);
  process.exit(1);
});

ws.addEventListener('close', (event) => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nWebSocket 关闭 (code: ${event.code})`);
  console.log(`总耗时: ${elapsed}s | 总消息数: ${messageCount}`);
  process.exit(event.code === 1000 ? 0 : 1);
});

// 超时保护
setTimeout(() => {
  console.error(`\n✗ 超时（${TIMEOUT_MS / 1000}s），强制退出`);
  ws.close();
  process.exit(1);
}, TIMEOUT_MS);
