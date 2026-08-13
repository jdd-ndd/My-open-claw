#!/usr/bin/env node
// scripts/tag.mjs
// 用法: `pnpm tag` 或 `node scripts/tag.mjs`
// 作用:
//   1. 读根 package.json 的 version
//   2. 检查当前 HEAD 是否已经打了 v<version> tag
//   3. 没打 → git tag v<version> HEAD
//   4. 询问用户 push (默认 n) → git push origin v<version>
//   5. 列出当前所有 v1.x tag 供参考
//
// 设计: 不在脚本里自动 push, 给用户最后一次反悔机会, 防止误推.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '..');
const pkgPath = resolve(rootDir, 'package.json');

if (!existsSync(pkgPath)) {
  console.error(`✗ package.json 不存在: ${pkgPath}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
const tagName = `v${version}`;

console.log(`\nMyOpenClaw release tag helper`);
console.log(`  root:   ${rootDir}`);
console.log(`  version: ${version}`);
console.log(`  target:  ${tagName}\n`);

// 查 HEAD commit
const headSha = execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
const headShort = headSha.slice(0, 7);
console.log(`  HEAD:    ${headShort}\n`);

// 查现有 tag
function listTags() {
  const out = execSync('git tag -l "v*" --sort=-version:refname', { cwd: rootDir, encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean);
}

const existing = listTags();
console.log(`  existing v* tags: ${existing.slice(0, 5).join(', ')}${existing.length > 5 ? '…' : ''}\n`);

if (existing.includes(tagName)) {
  // tag 已存在, 查对应 commit
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

// 打 tag
console.log(`→ 创建 tag: ${tagName} → ${headShort}`);
execSync(`git tag ${tagName} HEAD`, { cwd: rootDir, stdio: 'inherit' });

// 推送 (交互式, 用户可 Ctrl+C 取消)
const args = process.argv.slice(2);
const shouldPush = args.includes('--push') || args.includes('-p');
if (shouldPush) {
  console.log(`→ 推送 tag 到 origin`);
  execSync(`git push origin ${tagName}`, { cwd: rootDir, stdio: 'inherit' });
  console.log(`✓ 完成. tag ${tagName} 已在 origin 上.`);
} else {
  console.log(`\n✓ 本地 tag 已创建. 推送用: pnpm tag --push`);
  console.log(`  或: git push origin ${tagName}\n`);
}
