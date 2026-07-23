/**
 * 深度合并与克隆工具
 *
 * @module @myopenclaw/server/core/utils
 */

/** 深度合并多个对象，后者覆盖前者 */
export function deepMerge<T extends Record<string, unknown>>(target: T, ...sources: Partial<T>[]): T {
  if (!sources.length) return target;
  const result = { ...target } as Record<string, unknown>;
  for (const source of sources) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      const targetVal = result[key];
      const sourceVal = source[key];
      if (isPlainObject(targetVal) && isPlainObject(sourceVal)) {
        result[key] = deepMerge(targetVal as Record<string, unknown>, sourceVal as Record<string, unknown>);
      } else if (sourceVal !== undefined) {
        result[key] = sourceVal;
      }
    }
  }
  return result as T;
}

/**
 * 结构化克隆（依赖 Node 20+ 原生 structuredClone）
 *
 * 注意：Date、Map、Set、RegExp、ArrayBuffer 等类型均可正确深拷贝。
 * 不可克隆的类型（Function、WeakMap 等）将抛出 DataCloneError。
 */
export function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}
