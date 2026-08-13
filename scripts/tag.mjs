#!/usr/bin/env node
// scripts/tag.mjs
// 用法:
//   pnpm tag                  创建本地 tag (默认不 push)
//   pnpm tag --push           创建并 push 到 origin
//   node scripts/tag.mjs --check  只跑体检, 不打 tag
//
// 作用:
//   1. 读根 package.json 的 version (容错 BOM + 无效 JSON)
//   2. (可选) 跑 pre-release 体检 (release-check.mjs)
//   3. 检查当前 HEAD 是否已经打了 v<version> tag
//   4. 没打 → git tag v<version> HEAD
//   5. --push → git push origin v<version>
//   6. 列出当前所有 v1.x tag 供参考
//
// 设计:
//   - 不在脚本里自动 push, 默认给用户最后一次反悔机会.
//   - --check 模式: 跑体检, 退出码 0=可打 tag / 1=有问题.
//   - --skip-check: 跳过体检 (CI/automation 场景, 默认还是跑).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '..');
const pkgPath = resolve(rootDir, 'package.json');
const releaseCheckPath = join(here, 'release-check.mjs');

// ─── 参数解析 ─────────────────────────────────────────────
const args = process.argv.slice(2);
const shouldPush = args.includes('--push') || args.includes('-p');
const checkOnly = args.includes('--check');
const skipCheck = args.includes('--skip-check');

// ─── 读 package.json (容错 BOM) ────────────────────────────
if (!existsSync(pkgPath)) {
  console.error(`✗ package.json 不存在: ${pkgPath}`);
  process.exit(1);
}

let pkg;
try {
  // v1.1.6/7 历史上踩过 BOM 坑: PowerShell Set-Content 默认 utf8WithBom
  // 写出来的 package.json 头有 EF BB BF, 直接 JSON.parse 挂.
  // 这里先按字节 peek 第一个 byte 是不是 BOM, 有就 strip 掉.
  const raw = readFileSync(pkgPath);
  const text = raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf
    ? raw.subarray(3).toString('utf8')
    : raw.toString('utf8');
  pkg = JSON.parse(text);
} catch (err) {
  console.error(`✗ package.json 解析失败: ${(err instanceof Error ? err.message : String(err))}`);
  console.error(`  路径: ${pkgPath}`);
  console.error(`  提示: 检查 JSON 语法 (常见: 尾逗号 / 单引号 / BOM)`);
  process.exit(1);
}

const version = pkg.version;
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version)) {
  console.error(`✗ package.json version 字段非法: ${JSON.stringify(version)}`);
  console.error(`  期望格式: MAJOR.MINOR.PATCH (例如 1.1.9), 可选预发布后缀 (例如 1.2.0-rc.1)`);
  process.exit(1);
}

const tagName = `v${version}`;

console.log(`\nMyOpenClaw release tag helper`);
console.log(`  root:   ${rootDir}`);
console.log(`  version: ${version}`);
console.log(`  target:  ${tagName}\n`);

// ─── 查 HEAD commit ─────────────────────────────────────────
let headSha, headShort;
try {
  headSha = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
  headShort = headSha.slice(0, 7);
  console.log(`  HEAD:    ${headShort}\n`);
} catch (err) {
  console.error(`✗ git rev-parse HEAD 失败: ${err.message}`);
  process.exit(1);
}

// ─── Pre-release 体检 (可选) ────────────────────────────────
if (!skipCheck) {
  if (!existsSync(releaseCheckPath)) {
    console.warn(`⚠ release-check.mjs 不存在 (${releaseCheckPath}), 跳过体检.`);
  } else {
    console.log(`→ 跑 pre-release 体检 (release-check.mjs)\n`);
    const r = spawnSync(process.execPath, [releaseCheckPath], {
      cwd: rootDir,
      stdio: 'inherit',
    });
    if (r.status !== 0) {
      console.error(`\n✗ 体检未通过 (exit ${r.status}), 拒绝打 tag.`);
      console.error(`  强制跳过: pnpm tag --skip-check`);
      process.exit(1);
    }
    console.log(`\n✓ 体检通过\n`);
  }
}

if (checkOnly) {
  console.log(`✓ --check 模式: 体检通过, 可以打 ${tagName}.`);
  process.exit(0);
}

// ─── 查现有 tag ────────────────────────────────────────────
function listTags() {
  const out = execSync('git tag -l "v*" --sort=-version:refname', { cwd: rootDir, encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean);
}

const existing = listTags();
console.log(`  existing v* tags: ${existing.slice(0, 5).join(', ')}${existing.length > 5 ? '…' : ''}\n`);

if (existing.includes(tagName)) {
  const tagSha = execSync(`git rev-list -1 ${tagName}`, { cwd: rootDir, encoding: 'utf8' }).trim();
  if (tagSha === headSha) {
    console.log(`✓ ${tagName} 已存在且指向当前 HEAD (${headShort}), 无需操作.`);
    process.exit(0);
  } else {
    console.error(`✗ ${tagName} 已存在但指向 ${tagSha.slice(0, 7)}, 不是当前 HEAD.`);
    console.error(`  移动 tag 会破坏别人的 checkout, 请确认.`);
    console.error(`  如确认: git tag -d ${tagName} && git tag ${tagName} HEAD`);
    process.exit(1);
  }
}

// ─── 打 tag ─────────────────────────────────────────────────
console.log(`→ 创建 tag: ${tagName} → ${headShort}`);
try {
  execSync(`git tag ${tagName} HEAD`, { cwd: rootDir, stdio: 'inherit' });
} catch (err) {
  console.error(`✗ git tag 创建失败: ${err.message}`);
  process.exit(1);
}

// ─── 推送 ───────────────────────────────────────────────────
if (shouldPush) {
  console.log(`→ 推送 tag 到 origin`);
  try {
    execSync(`git push origin ${tagName}`, { cwd: rootDir, stdio: 'inherit' });
    console.log(`✓ 完成. tag ${tagName} 已在 origin 上.`);
  } catch (err) {
    console.error(`✗ git push 失败: ${err.message}`);
    console.error(`  本地 tag 已创建, 手动推送: git push origin ${tagName}`);
    process.exit(1);
  }
} else {
  console.log(`\n✓ 本地 tag 已创建. 推送用: pnpm tag --push`);
  console.log(`  或: git push origin ${tagName}\n`);
}
