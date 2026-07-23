/**
 * ID 生成工具
 *
 * @module @myopenclaw/server/core/utils
 */

import { ulid } from 'ulid';

/** 生成 ulid（26 字符、时序可排序） */
export function generateId(): string {
  return ulid();
}

/** 生成 UUID v4 */
export function generateUuid(): string {
  return crypto.randomUUID();
}
