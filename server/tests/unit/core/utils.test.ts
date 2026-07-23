/**
 * Core Utils 单元测试
 */
import { describe, it, expect, vi } from 'vitest';
import {
  generateId,
  generateUuid,
  now,
  formatTimestamp,
  sleep,
  retry,
  debounce,
  throttle,
  deepMerge,
  deepClone,
  safeJsonParse,
  truncate,
  maskKey,
} from '../../../src/core/utils/index.js';

describe('Core - Utils', () => {
  describe('generateId', () => {
    it('应生成 26 位 ulid 字符串', () => {
      const id = generateId();
      expect(id).toHaveLength(26);
    });

    it('每次生成应不同', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });

    it('应匹配 ulid 格式 (Base32, 不含 I L O U)', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });
  });

  describe('generateUuid', () => {
    it('应生成标准 UUID v4', () => {
      const id = generateUuid();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  describe('now', () => {
    it('应返回接近当前时间的毫秒时间戳', () => {
      const ts = now();
      expect(ts).toBeGreaterThan(1700000000000);
    });
  });

  describe('formatTimestamp', () => {
    it('应格式化为 ISO 8601 字符串', () => {
      const date = new Date('2026-07-21T12:00:00.000Z');
      const iso = formatTimestamp(date.getTime());
      expect(iso).toContain('2026-07-21');
      expect(iso).toContain('T');
    });
  });

  describe('sleep', () => {
    it('应等待指定毫秒后 resolve', async () => {
      const start = Date.now();
      await sleep(50);
      expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    });

    it('应支持 AbortSignal 取消', async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 10);
      await expect(sleep(1000, controller.signal)).rejects.toThrow('Sleep aborted');
    });
  });

  describe('retry', () => {
    it('首次成功时不重试', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await retry(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('达到最大重试次数后抛出最后一个错误', async () => {
      const err = new Error('fail');
      const fn = vi.fn().mockRejectedValue(err);
      await expect(retry(fn, { maxRetries: 2, initialDelayMs: 1 })).rejects.toThrow('fail');
      expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 重试
    });

    it('shouldRetry 返回 false 时立即抛出', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('non-retryable'));
      await expect(
        retry(fn, { maxRetries: 5, initialDelayMs: 1, shouldRetry: () => false }),
      ).rejects.toThrow('non-retryable');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('使用指数退避延迟', async () => {
      vi.useFakeTimers();
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('ok');
      const promise = retry(fn, { maxRetries: 3, initialDelayMs: 100, backoffFactor: 2, maxDelayMs: 10000 });
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;
      expect(result).toBe('ok');
      vi.useRealTimers();
    });
  });

  describe('debounce', () => {
    it('连续调用只执行最后一次', () => {
      vi.useFakeTimers();
      const fn = vi.fn();
      const debounced = debounce(fn, 100);
      debounced(1);
      debounced(2);
      debounced(3);
      vi.advanceTimersByTime(110);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(3);
      vi.useRealTimers();
    });
  });

  describe('throttle', () => {
    it('固定间隔内只执行一次', () => {
      vi.useFakeTimers();
      const fn = vi.fn();
      const throttled = throttle(fn, 100);
      throttled(1);
      throttled(2);
      throttled(3);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(1);
      vi.advanceTimersByTime(110);
      throttled(4);
      expect(fn).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  describe('deepMerge', () => {
    it('应深度合并嵌套对象', () => {
      const result = deepMerge({ a: { b: 1 } }, { a: { c: 2 } });
      expect(result).toEqual({ a: { b: 1, c: 2 } });
    });

    it('后者应覆盖前者', () => {
      const result = deepMerge({ a: 1 }, { a: 2 });
      expect(result.a).toBe(2);
    });

    it('undefined 不应覆盖已有值', () => {
      const result = deepMerge({ a: 1 } as Record<string, unknown>, { a: undefined });
      expect(result.a).toBe(1);
    });

    it('无 sources 时返回 target 自身（性能优化）', () => {
      const obj = { x: 1 };
      const result = deepMerge(obj);
      expect(result).toBe(obj); // 返回同一引用
      expect(result).toEqual(obj);
    });
  });

  describe('deepClone', () => {
    it('应深拷贝嵌套对象', () => {
      const obj = { a: { b: { c: 1 } } };
      const cloned = deepClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned.a).not.toBe(obj.a);
    });
  });

  describe('safeJsonParse', () => {
    it('应正确解析 JSON', () => {
      expect(safeJsonParse('{"a":1}', null)).toEqual({ a: 1 });
    });

    it('解析失败时返回 fallback', () => {
      expect(safeJsonParse('invalid', 'default')).toBe('default');
    });
  });

  describe('truncate', () => {
    it('超长字符串应截断并加省略号', () => {
      const result = truncate('hello world', 8);
      expect(result).toBe('hello...');
      expect(result.length).toBe(8);
    });

    it('短字符串不截断', () => {
      expect(truncate('hi', 10)).toBe('hi');
    });
  });

  describe('maskKey', () => {
    it('应脱敏长密钥', () => {
      const masked = maskKey('sk-1234567890abcdef');
      expect(masked).toBe('sk-****cdef');
    });

    it('短密钥返回全星号', () => {
      expect(maskKey('abc')).toBe('****');
    });
  });
});
