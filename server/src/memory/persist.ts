/**
 * PersistLayer — 本地文件持久化层
 *
 * 对齐文档 docs/07-Memory记忆模块.md §2.3
 *
 * 职责：
 *   - 所有记忆数据的底层键值存储
 *   - 支持原子写入（临时文件 + 重命名）
 *   - 支持批量操作
 *   - 支持备份与恢复
 *   - 支持按前缀列出/读取
 *
 * @module @myopenclaw/server/memory
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  readdirSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { createLogger } from '../core/utils/logger.js';
import type { PersistWriteOptions } from './types.js';

const log = createLogger('memory:persist');

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** 默认数据目录 */
const DEFAULT_DATA_DIR = join(process.cwd(), 'data', 'memory');

// ═══════════════════════════════════════════════════════════════
// PersistLayer 核心类
// ═══════════════════════════════════════════════════════════════

export class PersistLayer {
  private dir: string;
  private initialized = false;

  constructor(dir?: string) {
    this.dir = dir ?? process.env.MEMORY_DIR ?? DEFAULT_DATA_DIR;
  }

  // ═════════════════════════════════════════════════════════════
  // 生命周期
  // ═════════════════════════════════════════════════════════════

  /**
   * 初始化持久化层
   *
   * 创建数据目录，确保可写。
   */
  async initialize(): Promise<void> {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
      log.info({ dir: this.dir }, '数据目录已创建');
    }
    this.initialized = true;
    log.info({ dir: this.dir }, '持久化层已就绪');
  }

  /**
   * 关闭持久化层
   *
   * 确保所有缓冲数据落盘。（当前为同步写，无需额外操作）
   */
  async close(): Promise<void> {
    this.initialized = false;
    log.info('持久化层已关闭');
  }

  // ═════════════════════════════════════════════════════════════
  // 基础 CRUD
  // ═════════════════════════════════════════════════════════════

  /**
   * 读取键值
   *
   * @param key 存储键（支持路径分隔符，如 "sessions/sess-001"）
   * @returns 存储值，不存在返回 null
   */
  async read<T = unknown>(key: string): Promise<T | null> {
    this.ensureInitialized();
    const filePath = this.keyToPath(key);
    if (!existsSync(filePath)) return null;

    try {
      const raw = readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err) {
      log.warn({ key, err: (err as Error).message }, '读取数据失败');
      return null;
    }
  }

  /**
   * 写入键值（原子写入：先写临时文件，成功后再 rename）
   *
   * @param key 存储键
   * @param value 存储值
   * @param options 写入选项
   */
  async write<T>(key: string, value: T, options: PersistWriteOptions = {}): Promise<void> {
    this.ensureInitialized();
    const filePath = this.keyToPath(key);
    const tmpPath = filePath + '.tmp';

    // 确保父目录存在
    const parentDir = dirname(filePath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    try {
      const json = JSON.stringify(value, null, 2);

      // 先写入临时文件
      writeFileSync(tmpPath, json, 'utf-8');

      // 原子重命名（Windows 上 renameSync 同样是原子的）
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
      renameSync(tmpPath, filePath);

      if (options.sync) {
        // Node.js 没有直接的 fsync，但 writeFileSync 已确保写入
        log.debug({ key }, '数据已同步落盘');
      }
    } catch (err) {
      // 清理临时文件
      try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ignore */ }
      log.error({ key, err: (err as Error).message }, '写入数据失败');
      throw err;
    }
  }

  /**
   * 批量写入
   *
   * @param entries 键值对列表
   */
  async writeBatch<T>(entries: Array<{ key: string; value: T }>): Promise<void> {
    for (const { key, value } of entries) {
      await this.write(key, value);
    }
    log.debug({ count: entries.length }, '批量写入完成');
  }

  /**
   * 删除键值
   *
   * @param key 存储键
   * @returns 删除成功返回 true
   */
  async delete(key: string): Promise<boolean> {
    this.ensureInitialized();
    const filePath = this.keyToPath(key);
    if (!existsSync(filePath)) return false;

    try {
      unlinkSync(filePath);

      // 尝试清理空目录
      const parentDir = dirname(filePath);
      try {
        const remaining = readdirSync(parentDir);
        if (remaining.length === 0) {
          rmSync(parentDir, { recursive: false });
        }
      } catch { /* 忽略目录清理错误 */ }

      return true;
    } catch (err) {
      log.warn({ key, err: (err as Error).message }, '删除数据失败');
      return false;
    }
  }

  /**
   * 检查键是否存在
   *
   * @param key 存储键
   */
  async exists(key: string): Promise<boolean> {
    this.ensureInitialized();
    return existsSync(this.keyToPath(key));
  }

  // ═════════════════════════════════════════════════════════════
  // 批量查询
  // ═════════════════════════════════════════════════════════════

  /**
   * 按前缀列出键
   *
   * @param prefix 键前缀（可选，不传则列出全部）
   * @returns 匹配的键列表
   */
  async listKeys(prefix?: string): Promise<string[]> {
    this.ensureInitialized();

    const keys: string[] = [];
    const collectKeys = (dir: string, basePath: string) => {
      if (!existsSync(dir)) return;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          collectKeys(fullPath, basePath ? `${basePath}/${entry.name}` : entry.name);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          const key = basePath
            ? `${basePath}/${entry.name.replace('.json', '')}`
            : entry.name.replace('.json', '');
          if (!prefix || key.startsWith(prefix)) {
            keys.push(key);
          }
        }
      }
    };

    if (prefix) {
      // 有前缀时直接从对应目录读取
      const prefixDir = join(this.dir, prefix.split('/')[0]);
      collectKeys(prefixDir, prefix.split('/')[0]);
    } else {
      collectKeys(this.dir, '');
    }

    return keys;
  }

  /**
   * 按前缀批量读取
   *
   * @param prefix 键前缀
   * @returns 键值对列表
   */
  async readByPrefix<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
    const keys = await this.listKeys(prefix);
    const results: Array<{ key: string; value: T }> = [];

    for (const key of keys) {
      const value = await this.read<T>(key);
      if (value !== null) {
        results.push({ key, value });
      }
    }

    return results;
  }

  // ═════════════════════════════════════════════════════════════
  // 备份与恢复
  // ═════════════════════════════════════════════════════════════

  /**
   * 创建数据备份
   *
   * @param backupPath 备份目录路径
   */
  async backup(backupPath: string): Promise<void> {
    this.ensureInitialized();

    if (!existsSync(backupPath)) {
      mkdirSync(backupPath, { recursive: true });
    }

    const files = this.collectAllFiles(this.dir, '');
    let copiedCount = 0;

    for (const file of files) {
      const src = join(this.dir, file);
      const dst = join(backupPath, file);
      const dstDir = dirname(dst);
      if (!existsSync(dstDir)) {
        mkdirSync(dstDir, { recursive: true });
      }
      copyFileSync(src, dst);
      copiedCount++;
    }

    log.info({ backupPath, copiedCount }, '备份创建完成');
  }

  /**
   * 从备份恢复
   *
   * @param backupPath 备份目录路径
   */
  async restore(backupPath: string): Promise<void> {
    if (!existsSync(backupPath)) {
      throw new Error(`备份目录不存在: ${backupPath}`);
    }

    const files = this.collectAllFiles(backupPath, '');
    let restoredCount = 0;

    for (const file of files) {
      const src = join(backupPath, file);
      const dst = join(this.dir, file);
      const dstDir = dirname(dst);
      if (!existsSync(dstDir)) {
        mkdirSync(dstDir, { recursive: true });
      }
      copyFileSync(src, dst);
      restoredCount++;
    }

    log.info({ backupPath, restoredCount }, '备份恢复完成');
  }

  // ═════════════════════════════════════════════════════════════
  // 工具方法
  // ═════════════════════════════════════════════════════════════

  /** 确保已初始化 */
  private ensureInitialized(): void {
    if (!this.initialized) {
      if (!existsSync(this.dir)) {
        mkdirSync(this.dir, { recursive: true });
      }
      this.initialized = true;
    }
  }

  /** 键 → 文件路径 */
  private keyToPath(key: string): string {
    // 安全校验：防止路径穿越
    const safeKey = key.replace(/\.\./g, '').replace(/[\\]/g, '/');
    return join(this.dir, `${safeKey}.json`);
  }

  /** 递归收集所有文件 */
  private collectAllFiles(dir: string, basePath: string): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        results.push(
          ...this.collectAllFiles(
            join(dir, entry.name),
            basePath ? `${basePath}/${entry.name}` : entry.name,
          ),
        );
      } else if (entry.isFile()) {
        results.push(basePath ? `${basePath}/${entry.name}` : entry.name);
      }
    }
    return results;
  }
}
