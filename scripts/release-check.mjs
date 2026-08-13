#!/usr/bin/env node
// scripts/release-check.mjs
// 用法:
//   node scripts/release-check.mjs           默认 (快): git + BOM + version + changelog
//   node scripts/release-check.mjs --full    全: 加 typecheck + lint + test
//   node scripts/release-check.mjs --build   全 + build (很慢, 5min+)
//
// 作用: release 前体检, 输出 PASS/WARN/FAIL, 退出码 0/1.
// 被 scripts/tag.mjs 默认调用, 失败时拒绝打 tag.
//
// 检查项:
//   1. working tree 干净          (FAIL if dirty)
//   2. 当前 branch 跟 origin 同步  (FAIL if ahead/behind)
//   3. package.json 无 BOM         (FAIL if BOM)
//   4. package.json version 格式   (FAIL if bad)
//   5. changelog 跟 version 一致   (FAIL if 没章节或编号错)
//   6. (--full)   typecheck         (FAIL if err)
//   7. (--full)   lint 0 errors     (WARN if err, FAIL 仅自定义阈值)
//   8. (--full)   test pass         (FAIL if any fail)
//   9. (--build)  build 3 workspaces (FAIL if any err)

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '..');
const pkgPath = resolve(rootDir, 'package.json');

const args = process.argv.slice(2);
const full = args.includes('--full');
const withBuild = args.includes('--build');

console.log(`\nMyOpenClaw release pre-check`);
console.log(`  root:  ${rootDir}`);
console.log(`  mode:  ${withBuild ? 'full+build' : full ? 'full' : 'quick'}`);
console.log('');

let pass = 0, warn = 0, fail = 0;
const log = (level, name, msg) => {
  const tag = level === 'PASS' ? '✓' : level === 'WARN' ? '⚠' : '✗';
  console.log(`  ${tag} [${level}] ${name}${msg ? ' — ' + msg : ''}`);
  if (level === 'PASS') pass++;
  else if (level === 'WARN') warn++;
  else fail++;
};

// ─── 1. working tree 干净 ────────────────────────────────────
try {
  const status = execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf8' });
  // 排除 .worktrees/ (submodule dirty) 跟其他已知非 release 相关 dirty
  const relevant = status.split('\n').filter((l) => {
    if (!l.trim()) return false;
    if (l.includes('.worktrees/')) return false;  // 旧 worktree dirty
    if (l.endsWith('ppt-test-output.pptx') || l.endsWith('ppt-test-output.zip')) return false;
    if (l.includes('ppt-unzipped-')) return false;
    return true;
  });
  if (relevant.length === 0) {
    log('PASS', 'working tree', 'clean');
  } else {
    log('FAIL', 'working tree', `${relevant.length} dirty file(s) (排除 .worktrees/ 后)`);
    relevant.slice(0, 5).forEach((l) => console.log(`         ${l}`));
  }
} catch (err) {
  log('FAIL', 'working tree', err.message);
}

// ─── 2. 当前 branch 跟 origin 同步 ─────────────────────────
try {
  const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  if (currentBranch === 'master') {
    // 先 fetch 一下, 然后比较
    try {
      execSync('git fetch origin master --quiet', { cwd: rootDir, encoding: 'utf8', timeout: 30_000 });
    } catch {
      // fetch 失败可能是离线, 当 WARN
      log('WARN', 'sync origin', 'git fetch 失败, 跳过 (可能是离线)');
    }
    const local = execSync('git rev-parse master', { cwd: rootDir, encoding: 'utf8' }).trim();
    const remote = execSync('git rev-parse origin/master', { cwd: rootDir, encoding: 'utf8' }).trim();
    if (local === remote) {
      log('PASS', 'sync origin', `master = origin/master (${local.slice(0, 7)})`);
    } else {
      const ahead = parseInt(execSync('git rev-list --count master..origin/master', { cwd: rootDir, encoding: 'utf8' }).trim(), 10);
      const behind = parseInt(execSync('git rev-list --count origin/master..master', { cwd: rootDir, encoding: 'utf8' }).trim(), 10);
      log('FAIL', 'sync origin', `master ${behind} ahead / ${ahead} behind origin/master`);
    }
  } else {
    log('WARN', 'sync origin', `当前在 ${currentBranch}, 不是 master, 跳过同步检查`);
  }
} catch (err) {
  log('WARN', 'sync origin', err.message);
}

// ─── 3. package.json 无 BOM + 4. version 格式 ─────────────
if (!existsSync(pkgPath)) {
  log('FAIL', 'package.json', '不存在');
} else {
  const raw = readFileSync(pkgPath);
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    log('FAIL', 'package.json BOM', '文件头有 UTF-8 BOM (EF BB BF), 会让 JSON.parse 挂');
  } else {
    log('PASS', 'package.json BOM', '无 BOM');
  }

  let pkg;
  try {
    const text = raw[0] === 0xef ? raw.subarray(3).toString('utf8') : raw.toString('utf8');
    pkg = JSON.parse(text);
    log('PASS', 'package.json JSON', '解析成功');
  } catch (err) {
    log('FAIL', 'package.json JSON', `解析失败: ${err.message}`);
  }
  if (pkg) {
    const v = pkg.version;
    if (typeof v !== 'string' || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(v)) {
      log('FAIL', 'package.json version', `非法: ${JSON.stringify(v)}`);
    } else {
      log('PASS', 'package.json version', v);
    }
  }
}

// ─── 5. changelog 跟 version 一致 ──────────────────────────
const changelogPath = join(rootDir, 'docs/16-变更记录.md');
if (!existsSync(changelogPath)) {
  log('FAIL', 'changelog', `不存在: ${changelogPath}`);
} else {
  try {
    const cl = readFileSync(changelogPath, 'utf8');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));  // 假设上面已 pass
    const v = pkg.version;
    // 2.1 v1.1.9(...) 必须存在
    const sectionRe = new RegExp(`###\\s+2\\.1\\s+v${v.replace(/\./g, '\\.')}\\b`);
    if (sectionRe.test(cl)) {
      log('PASS', 'changelog 2.1', `v${v} 章节存在`);
    } else {
      log('FAIL', 'changelog 2.1', `找不到 v${v} 章节 (期望 ### 2.1 v${v}(...))`);
    }
    // 头部版本号
    if (cl.includes(`> **版本**：v${v}`) || cl.includes(`> **版本**: v${v}`)) {
      log('PASS', 'changelog header', `v${v} 一致`);
    } else {
      log('WARN', 'changelog header', `header 版本号跟 package.json 不一致 (期望 v${v})`);
    }
  } catch (err) {
    log('FAIL', 'changelog', err.message);
  }
}

// ─── 6/7/8. --full 模式: typecheck + lint + test ─────────
if (full || withBuild) {
  console.log('\n  --- --full 模式 (typecheck + lint + test) ---\n');

  // typecheck
  console.log('  · typecheck...');
  const tc = spawnSync('pnpm', ['typecheck'], { cwd: rootDir, stdio: 'pipe', encoding: 'utf8' });
  if (tc.status === 0) {
    log('PASS', 'typecheck', '');
  } else {
    log('FAIL', 'typecheck', `exit ${tc.status} (看上方日志)`);
  }

  // lint
  console.log('  · lint...');
  const ln = spawnSync('pnpm', ['lint'], { cwd: rootDir, stdio: 'pipe', encoding: 'utf8' });
  if (ln.status === 0) {
    // lint 退出 0 表示 0 errors (warnings 允许)
    log('PASS', 'lint', '0 errors');
  } else {
    // pnpm lint 退出 0 即使有 warnings, 退出非 0 一般是真有 error
    log('FAIL', 'lint', `exit ${ln.status} (看上方日志)`);
  }

  // test
  console.log('  · test...');
  const ts = spawnSync('pnpm', ['test'], { cwd: rootDir, stdio: 'pipe', encoding: 'utf8' });
  if (ts.status === 0) {
    log('PASS', 'test', 'all passed');
  } else {
    log('FAIL', 'test', `exit ${ts.status} (看上方日志)`);
  }
}

// ─── 9. --build 模式: build 3 workspaces ─────────────────
if (withBuild) {
  console.log('\n  --- --build 模式 (build) ---\n');
  console.log('  · build...');
  const bs = spawnSync('pnpm', ['build'], { cwd: rootDir, stdio: 'pipe', encoding: 'utf8' });
  if (bs.status === 0) {
    log('PASS', 'build', '3 workspaces');
  } else {
    log('FAIL', 'build', `exit ${bs.status}`);
  }
}

// ─── 汇总 ─────────────────────────────────────────────────
console.log(`\n  ─── 汇总 ───`);
console.log(`  PASS: ${pass}  WARN: ${warn}  FAIL: ${fail}`);

if (fail > 0) {
  console.error(`\n✗ 体检未通过 (${fail} FAIL). 拒绝 release.`);
  console.error(`  看上方 ✗ 行修问题.`);
  process.exit(1);
}

if (warn > 0) {
  console.log(`\n⚠ 体检通过但有 ${warn} WARN. 可以 release, 但建议看一下.`);
} else {
  console.log(`\n✓ 体检全过, 可以 release.`);
}
process.exit(0);
