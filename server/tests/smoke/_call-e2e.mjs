/**
 * 真实调用冒烟测试:验证 tools + skills 端到端可调用
 */
import { createToolRegistry } from '../../src/tools/index.ts';
import { SkillRegistry } from '../../src/skills/registry.ts';
import { SkillLoader } from '../../src/skills/loader.ts';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const log = (...args) => console.log('[e2e]', ...args);

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillsDir = resolve(__dirname, '..', '..', 'skills');

async function main() {
  log('=== 1. 工具注册 + invoke ===');
  const registry = await createToolRegistry();
  log(`✓ 注册了 ${registry.count} 个工具`);

  // 列出所有工具
  const allTools = registry.list();
  log('工具列表:');
  for (const t of allTools) {
    log(`  - ${t.name} (${t.category}/${t.risk})`);
  }

  log('');
  log('=== 2. 调用 fs/list_dir 真实读取当前目录 ===');
  const result1 = await registry.invoke(
    'fs/list_dir',
    { path: 'D:/模板/My open claw/server/src', recursive: false, pattern: '*.ts' },
    { sessionId: 'e2e', userId: 'tester', channelId: 'cli' },
  );
  log(`✓ fs/list_dir: success=${result1.success}, data.length=${Array.isArray(result1.data) ? result1.data.length : 'N/A'}`);
  if (result1.data) {
    log(`  前 5 项: ${JSON.stringify(result1.data.slice(0, 5).map(e => e.name))}`);
  }

  log('');
  log('=== 3. 调用 http/request 真实请求 example.com ===');
  const result2 = await registry.invoke(
    'http/request',
    { url: 'https://example.com', method: 'GET', timeout: 10000 },
    { sessionId: 'e2e', userId: 'tester', channelId: 'cli' },
  );
  log(`✓ http/request: success=${result2.success}, status=${result2.data?.status}`);
  if (result2.data?.body) {
    const body = typeof result2.data.body === 'string' ? result2.data.body : JSON.stringify(result2.data.body);
    log(`  body 前 100 字符: ${body.substring(0, 100).replace(/\n/g, ' ')}`);
  }

  log('');
  log('=== 4. 调用 exec/shell 真实执行命令 ===');
  const result3 = await registry.invoke(
    'exec/shell',
    { command: 'echo hello-from-moc', timeout: 5000 },
    { sessionId: 'e2e', userId: 'tester', channelId: 'cli' },
  );
  log(`✓ exec/shell: success=${result3.success}, stdout=${result3.data?.stdout}`);

  log('');
  log('=== 5. memory_search/search (注意: 当前是 mock) ===');
  const result4 = await registry.invoke(
    'memory_search/search',
    { query: 'typescript', topK: 3 },
    { sessionId: 'e2e', userId: 'tester', channelId: 'cli' },
  );
  log(`✓ memory_search/search: success=${result4.success}, results=${result4.data?.length}`);
  if (result4.data) {
    for (const m of result4.data) {
      log(`  - [score=${m.score.toFixed(2)}] ${m.content.substring(0, 60)}...`);
    }
  }

  log('');
  log('=== 6. browser/open 真实抓取 ===');
  const result5 = await registry.invoke(
    'browser/open',
    { url: 'https://example.com', timeout: 10000 },
    { sessionId: 'e2e', userId: 'tester', channelId: 'cli' },
  );
  log(`✓ browser/open: success=${result5.success}, title=${result5.data?.title}, contentLength=${result5.data?.textContent?.length}`);

  log('');
  log('=== 7. browser/click (注意: 当前是 mock) ===');
  const result6 = await registry.invoke(
    'browser/click',
    { selector: '#submit' },
    { sessionId: 'e2e', userId: 'tester', channelId: 'cli' },
  );
  log(`✓ browser/click: success=${result6.success}, note=${result6.data?.note}`);

  log('');
  log('=== 8. Skills 加载 + 触发匹配 ===');
  log(`skillsDir: ${skillsDir} (exists: ${existsSync(skillsDir)})`);
  const skillRegistry = new SkillRegistry(new SkillLoader());
  const loaded = skillRegistry.loadFromDirectory(skillsDir);
  log(`✓ 加载了 ${loaded} 个 skill:`);
  for (const s of skillRegistry.listAll()) {
    log(`  - ${s.meta.name} (${s.meta.priority ?? 'normal'}) triggers: [${(s.meta.triggers ?? []).join(', ')}]`);
  }

  log('');
  log('=== 9. Skills 触发匹配测试 ===');
  const userMsg = '请帮我审查一下这段 TypeScript 代码';
  const matched = skillRegistry.matchByTriggers(userMsg, 3);
  log(`✓ 用户消息 "${userMsg}" 匹配到 ${matched.length} 个 skill:`);
  for (const s of matched) {
    log(`  - ${s.meta.name}: ${s.meta.description}`);
  }

  log('');
  log('=== 10. Skills 提示词注入 ===');
  const prompt = skillRegistry.buildPrompt('请审查代码');
  log(`✓ buildPrompt() 输出长度: ${prompt.length} 字符`);
  log(`  前 200 字符: ${prompt.substring(0, 200).replace(/\n/g, ' | ')}`);

  log('');
  log('=== 全部测试完成 ===');
}

main().catch((err) => {
  console.error('[e2e] ERROR:', err);
  process.exit(1);
});
