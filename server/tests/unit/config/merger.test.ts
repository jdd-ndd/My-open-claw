/**
 * Merger 工具测试(deepMerge + applyEnvOverrides)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deepMerge, applyEnvOverrides } from '../../../src/core/config/merger.js';

describe('deepMerge — 对象', () => {
  it('同 key 标量覆盖', () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('嵌套对象递归合并', () => {
    const target = { x: { a: 1, b: 2 } };
    const source = { x: { b: 20, c: 30 } };
    const result = deepMerge(target, source);
    expect(result).toEqual({ x: { a: 1, b: 20, c: 30 } });
  });

  it('数组整体替换(不拼接)', () => {
    const target = { list: [1, 2, 3] };
    const source = { list: [4, 5] };
    const result = deepMerge(target, source);
    expect(result.list).toEqual([4, 5]);
  });

  it('null 整体覆盖', () => {
    const target = { x: { a: 1 } };
    const source = { x: null };
    const result = deepMerge(target, source);
    expect(result.x).toBeNull();
  });

  it('空 source 不影响 target', () => {
    const target = { a: 1, b: { c: 2 } };
    const result = deepMerge(target, {});
    expect(result).toEqual(target);
  });

  it('深嵌套 3 层', () => {
    const target = { a: { b: { c: { d: 1, e: 2 } } } };
    const source = { a: { b: { c: { e: 20, f: 30 } } } };
    const result = deepMerge(target, source);
    expect(result).toEqual({ a: { b: { c: { d: 1, e: 20, f: 30 } } } });
  });

  it('不修改原对象(深 clone)', () => {
    const target = { a: { b: 1 } };
    const source = { a: { c: 2 } };
    const result = deepMerge(target, source);
    expect(target).toEqual({ a: { b: 1 } });
    expect(source).toEqual({ a: { c: 2 } });
    expect(result).not.toBe(target);
  });
});

describe('applyEnvOverrides — MYOC_ 前缀', () => {
  // 每个 test 只 stub 自己关心的 env,避免互相干扰
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('标量数字字段覆盖(MYOC_NETWORK_WS_PORT=18800)', () => {
    vi.stubEnv('MYOC_NETWORK_WS_PORT', '18800');
    const config: Record<string, unknown> = { network: { ws: { port: 18780 } } };
    applyEnvOverrides(config);
    expect((config.network as Record<string, Record<string, unknown>>).ws.port).toBe(18800);
  });

  it('字符串字段覆盖(MYOC_LLM_API_KEY=sk-xxx)', () => {
    vi.stubEnv('MYOC_LLM_API_KEY', 'sk-env-override');
    const config: Record<string, unknown> = { llm: { apiKey: 'original' } };
    applyEnvOverrides(config);
    expect((config.llm as Record<string, unknown>).apiKey).toBe('sk-env-override');
  });

  it('布尔字段覆盖(MYOC_FEATURES_SCHEDULER=false)', () => {
    vi.stubEnv('MYOC_FEATURES_SCHEDULER', 'false');
    const config: Record<string, unknown> = { features: { scheduler: true } };
    applyEnvOverrides(config);
    expect((config.features as Record<string, unknown>).scheduler).toBe(false);
  });

  it('非 MYOC_ 前缀应被忽略', () => {
    vi.stubEnv('DEBUG_TRACE', 'true');
    const config: Record<string, unknown> = { debug: { trace: false } };
    applyEnvOverrides(config);
    expect((config.debug as Record<string, unknown>).trace).toBe(false);
  });

  it('中间路径不存在应自动创建对象', () => {
    vi.stubEnv('MYOC_NEW_KEY_VALUE', 'auto');
    const config: Record<string, unknown> = {};
    applyEnvOverrides(config);
    // 默认规则: 3 段全小写+点 → path = 'new.key.value'
    // 'auto' 是 value, 整个路径是 3 段
    expect((config as Record<string, Record<string, Record<string, string>>>).new.key.value).toBe('auto');
  });
});
