/**
 * Core Config 单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig, getConfig, clearConfigCache } from '../../../src/core/config/index.js';

describe('Core - Config', () => {
  beforeEach(() => {
    clearConfigCache();
    // 测试环境注入合法 env 避免 validator 抛 ConfigFatalError:
    // - MYOC_LLM_APIKEY / MYOC_EMBEDDING_APIKEY 避免 apiKey 占位符 fatal
    // - MYOC_NETWORK_HTTP_PORT 避免 ws/http port 撞 18780 fatal
    // - MYOC_NETWORK_WS_PORT 强制 18780 避免 _e2e.test.ts 残留 19999
    process.env.MYOC_LLM_APIKEY = 'test-key';
    process.env.MYOC_EMBEDDING_APIKEY = 'test-embed-key';
    process.env.MYOC_NETWORK_HTTP_PORT = '18790';
    process.env.MYOC_NETWORK_WS_PORT = '18780';
  });

  afterEach(() => {
    delete process.env.MYOC_LLM_APIKEY;
    delete process.env.MYOC_EMBEDDING_APIKEY;
    delete process.env.MYOC_NETWORK_HTTP_PORT;
    delete process.env.MYOC_NETWORK_WS_PORT;
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
