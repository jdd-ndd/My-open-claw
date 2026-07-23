/**
 * Persist �?本地文件持久化层
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../core/utils/logger.js';

const log = createLogger('memory:persist');

const DEFAULT_DIR = process.env.MEMORY_DIR ?? join(process.cwd(), 'data', 'memory');

export class PersistLayer {
  private dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? DEFAULT_DIR;
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  /** 写入持久化数�?*/
  async write(key: string, data: unknown): Promise<void> {
    const filePath = join(this.dir, `${key}.json`);
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    log.debug({ key }, '数据已持久化');
  }

  /** 读取持久化数�?*/
  async read<T = unknown>(key: string): Promise<T | null> {
    const filePath = join(this.dir, `${key}.json`);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  }
}
