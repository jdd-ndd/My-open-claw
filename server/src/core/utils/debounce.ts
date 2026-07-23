/**
 * 防抖/节流工具
 *
 * @module @myopenclaw/server/core/utils
 */

/** 防抖：延迟执行，连续调用只执行最后一次 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; fn(...args); }, ms);
  };
}

/** 节流：固定间隔内只执行一次 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let lastTime = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastTime >= ms) {
      lastTime = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => { lastTime = Date.now(); timer = undefined; fn(...args); }, ms - (now - lastTime));
    }
  };
}
