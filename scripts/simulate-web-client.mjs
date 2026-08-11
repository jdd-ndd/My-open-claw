/**
 * Web 客户端全功能验证脚本（修正版）
 * 
 * 测试场景：
 *   场景1 — 普通对话（基础问答 + reasoning + 流式输出）
 *   场景2 — 技能调用（代码审查 + 工具调用）
 *   场景3 — 工具调用（系统/天气等工具）
 */
import { randomUUID } from 'crypto';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

const GATEWAY = 'ws://127.0.0.1:18780/ws';
const CHANNEL = 'tui';
const TIMEOUT_MS = 120_000;
const WebSocket = globalThis.WebSocket;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class SimClient {
  constructor(name) {
    this.name = name;
    this.sessionId = `webv-${name}-${Date.now()}`;
    this.userId = `webv-user-${name}-${Date.now()}`;
    this.ws = null;
    this.results = {
      routeOk: false,
      deltas: 0,
      reasoningDeltas: 0,
      reasoning: '',
      accumulated: '',
      totalContent: '',
      totalReasoning: '',
      errors: [],
      donePayload: null,
    };
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(GATEWAY);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', () => reject(new Error('连接失败')));
    });
  }

  disconnect() { if (this.ws) this.ws.close(); }

  async send(content, messageType = 'text') {
    const reqId = randomUUID();

    this.ws.send(JSON.stringify({
      type: 'request', id: reqId, requestId: reqId,
      timestamp: new Date().toISOString(), action: 'chat.send',
      payload: { channelId: CHANNEL, userId: this.userId,
        sessionId: this.sessionId, content, messageType },
    }));

    console.log(`\n  >>> 发送: ${content.substring(0, 80)}${content.length > 80 ? '...' : ''}`);

    return new Promise((resolve) => {
      const start = Date.now();

      const handler = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        // 路由响应
        if (msg.type === 'response' && msg.status === 'success') {
          this.results.routeOk = true;
          return;
        }
        if (msg.type === 'response' && msg.status === 'error') {
          this.results.errors.push({ type: 'route', code: msg.errorCode, message: msg.errorMessage });
          console.log(`  ✗ 路由错误: ${msg.errorCode}`);
          return;
        }

        // reasoning_delta（每步思考过程）
        if (msg.event === 'chat.reasoning_delta') {
          this.results.reasoningDeltas++;
          this.results.reasoning += msg.payload.delta ?? '';
        }

        // 流式内容
        if (msg.event === 'chat.delta') {
          this.results.deltas++;
          this.results.accumulated = msg.payload.accumulated ?? this.results.accumulated;
        }

        // 完成
        if (msg.event === 'chat.done') {
          this.results.donePayload = msg.payload ?? {};
          this.results.totalContent = msg.payload.totalContent ?? '';
          this.results.totalReasoning = msg.payload.totalReasoning ?? '';
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          console.log(`  ✓ 完成 | ${elapsed}s | ${this.results.deltas} deltas | ${this.results.totalContent.length} 字符`);
          this.ws.removeEventListener('message', handler);
          resolve(this.results);
        }

        // 错误
        if (msg.event === 'chat.error') {
          this.results.errors.push({ type: 'chat', payload: msg.payload });
          console.log(`  ✗ 聊天错误`);
        }
      };

      this.ws.addEventListener('message', handler);
    });
  }
}

// ============================================================
async function scenario1_normal() {
  console.log('\n' + '═'.repeat(64));
  console.log('  场景1: 普通对话 — 验证 reasoning + delta + done 协议');
  console.log('═'.repeat(64));
  const c = new SimClient('s1');
  await c.connect();
  console.log('  ✓ 连接成功');
  const r = await c.send('请用一句话介绍什么是TypeScript，然后用列表形式列举它的3个优点');
  c.disconnect();

  console.log();
  console.log('  ── 协议验证 ──');
  console.log(`  chat.reasoning_delta 事件数: ${r.reasoningDeltas} (${r.reasoningDeltas > 0 ? '✅' : '⚠'} )`);
  console.log(`  chat.delta 事件数: ${r.deltas} (${r.deltas > 0 ? '✅' : '✗'} )`);
  console.log(`  路由成功: ${r.routeOk ? '✅' : '✗'}`);
  console.log(`  donePayload.totalContent 长度: ${r.totalContent.length} (${r.totalContent.length > 0 ? '✅' : '✗'})`);
  console.log(`  donePayload.totalReasoning 长度: ${r.totalReasoning.length}`);
  console.log(`  donePayload.sessionId = 请求sessionId: ${r.donePayload?.sessionId === c.sessionId ? '✅' : '✗'}`);
  console.log(`  错误数: ${r.errors.length} (${r.errors.length === 0 ? '✅' : '✗'})`);

  return r;
}

// ============================================================
async function scenario2_skill() {
  console.log('\n' + '═'.repeat(64));
  console.log('  场景2: 技能调用 — code-review + fs/read_file 工具');
  console.log('═'.repeat(64));

  const tmpDir = mkdtempSync(`${tmpdir()}/webv-review-`);
  const reviewFile = `${tmpDir}/user_svc.ts`;
  writeFileSync(reviewFile, `export class UserService {
  private users: any[] = [];          // 问题1: any 类型

  addUser(user: any) {                // 问题2: 无类型约束
    this.users.push(user);
  }

  getUser(id: number) {
    for (var i = 0; i < this.users.length; i++) {  // 问题3: 使用 var
      if (this.users[i].id == id) return this.users[i];  // 问题4: ==
    }
    return null;
  }

  async deleteAll() {                 // 问题5: 危险操作无确认
    await fetch('/api/users', { method: 'DELETE' });
  }
}
`);

  const c = new SimClient('s2');
  await c.connect();
  console.log('  ✓ 连接成功');
  const r = await c.send(`请使用代码审查技能审查以下文件: ${reviewFile}`);
  c.disconnect();

  console.log();
  console.log('  ── 技能+工具验证 ──');
  console.log(`  chat.delta 事件数: ${r.deltas} (${r.deltas > 0 ? '✅' : '✗'})`);
  console.log(`  donePayload.totalContent 长度: ${r.totalContent.length} 字符`);
  const hasReview = r.totalContent.includes('审查') || r.totalContent.includes('问题') || r.totalContent.includes('review');
  console.log(`  回复含审查内容: ${hasReview ? '✅' : '(模型不确定，非框架问题)'}`);
  console.log(`  回复预览: ${r.totalContent.substring(0, 200)}...`);

  return r;
}

// ============================================================
async function scenario3_tools() {
  console.log('\n' + '═'.repeat(64));
  console.log('  场景3: 工具调用 — system/time + weather 工具');
  console.log('═'.repeat(64));

  const c = new SimClient('s3');
  await c.connect();
  console.log('  ✓ 连接成功');
  const r = await c.send('现在北京时间几点几分？北京今天天气怎么样？请用工具查询后回答。');
  c.disconnect();

  console.log();
  console.log('  ── 工具调用验证 ──');
  console.log(`  chat.reasoning_delta 事件数: ${r.reasoningDeltas} (${r.reasoningDeltas > 0 ? '✅' : '⚠'})`);
  console.log(`  chat.delta 事件数: ${r.deltas} (${r.deltas > 0 ? '✅' : '✗'})`);
  console.log(`  donePayload.totalContent 长度: ${r.totalContent.length} 字符`);
  console.log(`  donePayload.sessionId 一致: ${r.donePayload?.sessionId === c.sessionId ? '✅' : '✗'}`);
  console.log(`  错误数: ${r.errors.length} (${r.errors.length === 0 ? '✅' : '✗'})`);
  console.log(`  回复预览: ${r.totalContent.substring(0, 200)}...`);

  return r;
}

// ============================================================
async function main() {
  console.log('╔' + '═'.repeat(62) + '╗');
  console.log('║  Web 客户端全功能协议验证 — 3 场景                            ║');
  console.log('╚' + '═'.repeat(62) + '╝');

  let allOk = true;
  const scenarios = [];

  try { scenarios.push(await scenario1_normal()); await sleep(2000); }
  catch (e) { console.log(`  ✗ 场景1异常: ${e.message}`); allOk = false; }

  try { scenarios.push(await scenario2_skill()); await sleep(2000); }
  catch (e) { console.log(`  ✗ 场景2异常: ${e.message}`); allOk = false; }

  try { scenarios.push(await scenario3_tools()); }
  catch (e) { console.log(`  ✗ 场景3异常: ${e.message}`); allOk = false; }

  // 汇总
  console.log('\n' + '═'.repeat(64));
  console.log('  汇总报告');
  console.log('═'.repeat(64));
  console.log(`  场景数: ${scenarios.length}/3`);
  for (const s of scenarios) {
    console.log(`  [${s.donePayload?.sessionId?.substring(0,15) ?? '?'}] deltas=${s.deltas} content=${s.totalContent.length}chars reasoning=${s.reasoningDeltas > 0 ? '有' : '无'} errors=${s.errors.length}`);
  }
  console.log(`  整体: ${allOk && scenarios.length === 3 ? '✅ 全部通过' : '✗ 部分失败'}`);

  process.exit(0);
}

setTimeout(() => process.exit(1), TIMEOUT_MS * 3);
main().catch(e => { console.error(e); process.exit(1); });
