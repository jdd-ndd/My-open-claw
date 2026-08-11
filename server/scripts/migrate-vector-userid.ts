/**
 * 向量记忆 userId 数据迁移脚本
 *
 * 用途：把所有 userId 统一迁移到当前共享 userId（SHARED_USER_ID='shared-user'）
 *
 * 问题背景：
 *   - Web 客户端当前使用统一的 userId='shared-user'
 *   - 历史数据中混入了 web-user、default-user、tui-user、load-user-xxx、user-xxx
 *     等各种 userId 的记忆
 *   - 检索时按 userId 过滤，导致这些历史记忆无法被检索到
 *
 * 修复策略：
 *   - 将所有非 shared-user 的 metadata.userId 批量更新为 'shared-user'
 *   - 同时把 sessionId 统一改写为 'legacy-shared' 前缀，避免污染新会话历史
 *   - 创建备份（index.json.bak）确保可回滚
 *
 * 使用方法：
 *   $ cd server
 *   $ npx tsx scripts/migrate-vector-userid.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const VECTORS_DIR = path.resolve(process.cwd(), 'data', 'memory', 'vectors');
const INDEX_FILE = path.join(VECTORS_DIR, 'index.json');
const TARGET_USER_ID = 'shared-user';
const LEGACY_SESSION_PREFIX = 'legacy-';

interface VectorEntry {
  id: string;
  content: string;
  embedding: number[];
  dimension: number;
  metadata: {
    sessionId?: string;
    userId?: string;
    type?: string;
    importance?: number;
    tags?: string[];
    createdAt?: number;
    [k: string]: unknown;
  };
}

function main(): void {
  if (!fs.existsSync(INDEX_FILE)) {
    console.error(`向量索引文件不存在: ${INDEX_FILE}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(INDEX_FILE, 'utf-8');
  const entries: VectorEntry[] = JSON.parse(raw);

  let updated = 0;
  let skipped = 0;
  const userIdStats: Record<string, number> = {};

  for (const entry of entries) {
    const currentUserId = entry.metadata?.userId;
    if (!currentUserId) {
      skipped += 1;
      continue;
    }
    userIdStats[currentUserId] = (userIdStats[currentUserId] ?? 0) + 1;

    if (currentUserId !== TARGET_USER_ID) {
      entry.metadata.userId = TARGET_USER_ID;
      // 历史遗留的 sessionId 一并规范化到 'legacy-*' 前缀，避免污染新会话历史
      if (entry.metadata.sessionId && !entry.metadata.sessionId.startsWith(LEGACY_SESSION_PREFIX)) {
        entry.metadata.sessionId = `${LEGACY_SESSION_PREFIX}${entry.metadata.sessionId}`;
      }
      updated += 1;
    }
  }

  console.log('=== 迁移前统计 ===');
  console.log(`总条目: ${entries.length}, 跳过（无 userId）: ${skipped}`);
  console.log(`userId 分布数: ${Object.keys(userIdStats).length}`);
  console.log(`待更新: ${updated}`);

  if (updated === 0) {
    console.log('无需迁移，退出');
    return;
  }

  // 备份
  const backupPath = `${INDEX_FILE}.bak`;
  fs.writeFileSync(backupPath, raw, 'utf-8');
  console.log(`已备份至: ${backupPath}`);

  // 写入（原子：先写 .tmp 再 rename，避免半文件）
  const tmpPath = `${INDEX_FILE}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
  fs.renameSync(tmpPath, INDEX_FILE);
  console.log(`已更新 ${updated} 条记忆到 userId=${TARGET_USER_ID}`);

  // 重新统计
  const afterStats: Record<string, number> = {};
  for (const entry of entries) {
    const u = entry.metadata?.userId ?? '<none>';
    afterStats[u] = (afterStats[u] ?? 0) + 1;
  }
  console.log('=== 迁移后统计 ===');
  console.log('userId 分布:', afterStats);
}

main();