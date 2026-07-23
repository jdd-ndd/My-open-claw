/**
 * 时间处理工具
 *
 * @module @myopenclaw/server/core/utils
 */

/** 当前 Unix 毫秒时间戳 */
export function now(): number {
  return Date.now();
}

/** 格式化时间戳为 ISO 8601 字符串 */
export function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString();
}

/** Promise 化的延时（支持 AbortSignal 取消） */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms < 0) {
    throw new Error('sleep: ms must be >= 0');
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Sleep aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Sleep aborted'));
    });
  });
}
