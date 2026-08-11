/**
 * Core Config 单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig, getConfig, clearConfigCache } from '../../../src/core/config/index.js';

describe('Core - Config', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  it('loadConfig 应返回包含 network 配置的对象', () => {
    const config = loadConfig();
    expect(config).toBeDefined();
    expect(config).toHaveProperty('network');
  });

  it('getConfig 应支持点路径访问', () => {
    const port = getConfig<number>('network.ws.port');
    expect(port).toBe(18780);
  });

  it('getConfig 路径不存在时返回默认值', () => {
    const val = getConfig('nonexistent', 'fallback');
    expect(val).toBe('fallback');
  });

  it('应使用缓存避免重复读取', () => {
    const c1 = loadConfig();
    const c2 = loadConfig();
    expect(c1).toBe(c2);
  });

  it('clearConfigCache 应清除缓存', () => {
    loadConfig();
    clearConfigCache();
    const config = loadConfig();
    expect(config).toBeDefined();
  });
});
