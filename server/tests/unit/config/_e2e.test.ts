/**
 * 端到端验证: 用户 JSON 配置通过 MYOC_CONFIG_PATH 独立加载
 *
 * 不依赖真实 ~/.myopenclaw/config.json,纯用临时目录 + env 覆盖验证:
 * - JSON 路径解析正确
 * - JSON 覆盖 defaults/yaml
 * - validator 通过
 * - getConfig dot-path 读到 JSON 字段
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, clearConfigCache, getConfig, userConfigExists, resolveUserConfigPath } from '../../../src/core/config/index.js';

describe('配置 e2e — 独立临时 JSON', () => {
  let tmpDir: string;
  let jsonPath: string;

  const VALID_E2E_CONFIG = {
    app: { name: 'e2e', mode: 'production' },
    network: {
      ws: { host: '127.0.0.1', port: 19999, path: '/ws' },
      http: { host: '127.0.0.1', port: 19998, basePath: '' },
    },
    llm: {
      provider: 'deepseek',
      apiKey: 'sk-e2e-test-key-32-chars-long-1234567',
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
      models: [{ id: 'deepseek-v4-flash', contextWindow: 128_000, maxOutputTokens: 8_192 }],
    },
    embedding: {
      provider: 'openai',
      apiKey: 'sk-e2e-emb-key-1234567890',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    },
    memory: { persist: { backend: 'sqlite', path: '/tmp/e2e-mem.db' } },
    security: {
      authToken: 'e2e-test-secure-token-32-chars-abcdef',
      sandbox: { workDir: '/tmp/e2e-ws' },
    },
  };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'myoc-e2e-'));
    // 模拟项目根(避免读真实 config/config.yaml)
    const projectDir = join(tmpDir, 'project');
    mkdirSync(join(projectDir, 'config'), { recursive: true });
    writeFileSync(join(projectDir, 'config', 'config.yaml'), '');
    vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    // JSON 写到独立位置
    jsonPath = join(tmpDir, 'user.json');
    writeFileSync(jsonPath, JSON.stringify(VALID_E2E_CONFIG));

    // env 指向独立 JSON
    vi.stubEnv('MYOC_CONFIG_PATH', jsonPath);
    // 显式 unset 外部 env(避免覆盖 JSON 配置)
    // 注意: vi.stubEnv(KEY, undefined) 在 Node 下会设 'undefined' 字符串,
    //       要真删除必须用 delete process.env.KEY
    delete process.env.MYOC_LLM_API_KEY;
    delete process.env.MYOC_LLM_APIKEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;

    clearConfigCache();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    // 还原被 delete 的 env
    process.env.MYOC_LLM_API_KEY = process.env.MYOC_LLM_API_KEY ?? '';
    process.env.MYOC_LLM_APIKEY = process.env.MYOC_LLM_APIKEY ?? '';
    process.env.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';
    clearConfigCache();
  });

  it('应能解析到独立 JSON 路径', () => {
    expect(userConfigExists()).toBe(true);
    expect(resolveUserConfigPath()).toBe(jsonPath);
  });

  it('loadConfig() 应成功(用户 JSON 满足所有必填)', () => {
    expect(() => loadConfig()).not.toThrow();
  });

  it('JSON 配置应覆盖 defaults 的字段', () => {
    const cfg = loadConfig();
    expect((cfg.network as Record<string, Record<string, unknown>>).ws.port).toBe(19999);
    expect((cfg.network as Record<string, Record<string, unknown>>).http.port).toBe(19998);
  });

  it('JSON 配置应满足 llm.apiKey 校验', () => {
    const cfg = loadConfig();
    const llm = cfg.llm as Record<string, unknown>;
    expect(llm.provider).toBe('deepseek');
    expect(String(llm.apiKey)).toContain('sk-e2e');
  });

  it('getConfig() dot-path 应能读到 JSON 字段', () => {
    expect(getConfig<number>('network.ws.port')).toBe(19999);
    expect(getConfig<string>('llm.provider')).toBe('deepseek');
    expect(getConfig<string>('llm.apiKey')).toContain('sk-e2e');
    expect(getConfig<string>('security.authToken')).toContain('e2e-test');
  });
});
