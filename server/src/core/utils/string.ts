/**
 * 字符串处理工具
 *
 * @module @myopenclaw/server/core/utils
 */

/** 安全 JSON 解析（不抛异常） */
export function safeJsonParse<T = unknown>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

/** 字符串截断 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

/** 脱敏密钥（保留前3后4位） */
export function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 3) + '****' + key.slice(-4);
}
