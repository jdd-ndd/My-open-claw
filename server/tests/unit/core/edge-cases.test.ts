/**
 * Core 模块 — 边界条件与异常场景测试
 *
 * @module server/tests/unit/core
 */

import { describe, it, expect, vi } from 'vitest';
import { createLogger } from '../../../src/core/utils/logger.js';
import { AppError } from '../../../src/core/errors/AppError.js';
import { ErrorCode } from '../../../src/core/errors/codes.js';
import { deepMerge } from '../../../src/core/utils/deep-merge.js';
import { generateId } from '../../../src/core/utils/id.js';
import { retry } from '../../../src/core/utils/retry.js';
import { now, formatTimestamp, sleep } from '../../../src/core/utils/time.js';
import { truncate, maskKey, safeJsonParse } from '../../../src/core/utils/string.js';
import { debounce } from '../../../src/core/utils/debounce.js';
import {
  DEFAULT_GATEWAY_PORT,
  LLM_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  EventType,
  PROTOCOL_VERSION,
  FRAMEWORK_NAME,
} from '../../../src/core/constants/index.js';

// ══════════════════════════════════════════════════════════════
// Logger
// ══════════════════════════════════════════════════════════════

describe('createLogger — 异常与边界', () => {
  it('相同 scope 应返回同一个实例（缓存）', () => {
    const a = createLogger('test:cache');
    const b = createLogger('test:cache');
    expect(a).toBe(b);
  });

  it('不同 scope 应返回不同实例', () => {
    const a = createLogger('test:a');
    const b = createLogger('test:b');
    expect(a).not.toBe(b);
  });

  it('scope 名称为空字符串应正常', () => {
    expect(() => createLogger('')).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════
// AppError
// ══════════════════════════════════════════════════════════════

describe('AppError — 异常与边界', () => {
  it('error.code 应为数字', () => {
    const err = new AppError({ code: ErrorCode.VALIDATION, message: 'test' });
    expect(typeof err.code).toBe('number');
  });

  it('error.message 应正确存储', () => {
    const err = new AppError({ code: ErrorCode.INTERNAL, message: '内部错误' });
    expect(err.message).toBe('内部错误');
  });

  it('错误码应正确映射', () => {
    expect(ErrorCode.VALIDATION).toBe(200001);
    expect(ErrorCode.SESSION_NOT_FOUND).toBe(500001);
    expect(ErrorCode.INTERNAL).toBe(100001);
  });
});

// ══════════════════════════════════════════════════════════════
// deepMerge
// ══════════════════════════════════════════════════════════════

describe('deepMerge — 异常与边界', () => {
  it('空对象合并应返回原值', () => {
    expect(deepMerge({ a: 1 }, {})).toEqual({ a: 1 });
    expect(deepMerge({}, { b: 2 })).toEqual({ b: 2 });
  });

  it('嵌套对象应深度合并', () => {
    const a = { x: { y: 1, z: 2 } };
    const b = { x: { z: 3, w: 4 } };
    expect(deepMerge(a, b)).toEqual({ x: { y: 1, z: 3, w: 4 } });
  });

  it('数组应直接覆盖而非合并', () => {
    expect(deepMerge({ arr: [1, 2] }, { arr: [3] })).toEqual({ arr: [3] });
  });

  it('null/undefined 值应正确处理', () => {
    expect(deepMerge({ a: null }, { a: 1 })).toEqual({ a: 1 });
  });
});

// ══════════════════════════════════════════════════════════════
// generateId
// ══════════════════════════════════════════════════════════════

describe('generateId — 异常与边界', () => {
  it('不应返回空字符串', () => {
    expect(generateId()).toBeTruthy();
    expect(generateId().length).toBeGreaterThan(0);
  });

  it('连续生成应返回不同的值', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

// ══════════════════════════════════════════════════════════════
// retry
// ══════════════════════════════════════════════════════════════

describe('retry — 异常与边界', () => {
  it('函数成功时不应重试', async () => {
    let calls = 0;
    const fn = async () => { calls++; return 'ok'; };
    const result = await retry(fn, { maxRetries: 3, delay: 10 });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('函数失败时应在最大重试次数内尝试', async () => {
    let calls = 0;
    const fn = async () => { calls++; throw new Error('fail'); };
    await expect(retry(fn, { maxRetries: 2, delay: 10 })).rejects.toThrow('fail');
    expect(calls).toBe(3);
  });

  it('maxRetries=0 时应只执行一次', async () => {
    let calls = 0;
    const fn = async () => { calls++; throw new Error('fail'); };
    await expect(retry(fn, { maxRetries: 0, delay: 10 })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════
// time utilities
// ══════════════════════════════════════════════════════════════

describe('time utilities — 异常与边界', () => {
  it('now() 应返回当前时间戳', () => {
    const ts = now();
    expect(ts).toBeGreaterThan(0);
    expect(ts).toBeLessThanOrEqual(Date.now());
  });

  it('formatTimestamp 应返回 ISO 8601 格式', () => {
    const ts = 1700000000000;
    const result = formatTimestamp(ts);
    expect(result).toContain('2023-11-14');
  });

  it('sleep 应在指定延迟后 resolve', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });

  it('sleep 负数应抛出', () => {
    // sleep 在负数时同步抛出，不是异步 reject
    expect(() => sleep(-1)).toThrow();
  });
});

// ══════════════════════════════════════════════════════════════
// string utilities
// ══════════════════════════════════════════════════════════════

describe('string utilities — 异常与边界', () => {
  it('truncate 短字符串不应截断', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncate 长字符串应截断并加 ...', () => {
    const result = truncate('hello world', 5);
    expect(result).toContain('...');
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('truncate 空字符串不应报错', () => {
    expect(truncate('', 5)).toBe('');
  });

  it('maskKey 短密钥应返回 ****', () => {
    expect(maskKey('abc')).toBe('****');
  });

  it('maskKey 长密钥应脱敏', () => {
    const masked = maskKey('sk-1234567890abcdef');
    expect(masked).toContain('****');
    expect(masked.length).toBeLessThan('sk-1234567890abcdef'.length);
  });

  it('safeJsonParse 合法 JSON 应正常解析', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('safeJsonParse 非法 JSON 应返回 fallback', () => {
    expect(safeJsonParse('not json', { fallback: true })).toEqual({ fallback: true });
  });
});

// ══════════════════════════════════════════════════════════════
// debounce
// ══════════════════════════════════════════════════════════════

describe('debounce — 异常与边界', () => {
  it('应在延迟后执行', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

// ══════════════════════════════════════════════════════════════
// 常量
// ══════════════════════════════════════════════════════════════

describe('常量 — 边界测试', () => {
  it('DEFAULT_GATEWAY_PORT 应为 18780', () => {
    expect(DEFAULT_GATEWAY_PORT).toBe(18780);
  });

  it('LLM_TIMEOUT_MS 应为合理值', () => {
    expect(LLM_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('HEARTBEAT_INTERVAL_MS 应为 30000', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(30000);
  });

  it('EventType 应包含事件枚举', () => {
    expect(EventType).toBeDefined();
    expect(typeof EventType.MESSAGE_RECEIVED).toBe('string');
  });

  it('PROTOCOL_VERSION 应定义', () => {
    expect(PROTOCOL_VERSION).toBe('1.0.0');
  });

  it('FRAMEWORK_NAME 应为 MyOpenClaw', () => {
    expect(FRAMEWORK_NAME).toBe('MyOpenClaw');
  });
});
