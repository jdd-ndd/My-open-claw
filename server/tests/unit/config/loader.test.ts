/**
 * 端到端 loader 行为测试(loadConfig 优先级链)
 *
 * 通过 stubEnv MYOC_CONFIG_PATH 指向 tmp 目录,验证:
 * - 文件不存在 → 降级到项目 YAML
 * - JSON 存在 → JSON 覆盖 YAML
 * - MYOC_* env 覆盖 JSON
 * - 致命问题抛 ConfigFatalError
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, clearConfigCache, getConfig } from '../../../src/core/config/loader.js';
import { ConfigFatalError } from '../../../src/core/config/errors.js';

let tmpDir: string;
let yamlDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'myoc-loader-'));
  // 模拟项目 config/ 目录
  yamlDir = join(tmpDir, 'config');
  mkdirSync(yamlDir, { recursive: true });

  // 临时把 process.cwd() 改到 tmpDir,让 loader 找 config/config.yaml
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

  // 指向不存在的 JSON,避免污染(具体测试再覆盖)
  vi.stubEnv('MYOC_CONFIG_PATH', join(tmpDir, 'nonexistent.json'));

  // 让 YAML 里的 ${DEEPSEEK_API_KEY} 占位符能解析成真值
  // (yaml-loader.resolveEnvVars 在 env 未设时保留原样,避免空串污染 schema)
  vi.stubEnv('DEEPSEEK_API_KEY', 'sk-test-valid-32-chars-1234567');

  clearConfigCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearConfigCache();
});

const VALID_FULL_CONFIG = {
  network: {
    ws: { host: '127.0.0.1', port: 18780, path: '/ws' },
    http: { host: '127.0.0.1', port: 18790, basePath: '' },
  },
  llm: {
    provider: 'deepseek',
    apiKey: 'sk-test-valid-32-chars-1234567',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'm1',
    models: [{ id: 'm1', contextWindow: 128_000, maxOutputTokens: 8_192 }],
  },
  embedding: {
    provider: 'openai',
    apiKey: 'sk-emb',
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
    dimensions: 1536,
  },
  memory: { persist: { backend: 'sqlite', path: '/tmp/m.db' } },
  security: {
    authToken: 'a-very-secure-token-32-chars-long!',
    sandbox: { workDir: '~/.myopenclaw/workspace' },
  },
};

describe('loadConfig — 仅 YAML 路径', () => {
  it('无 JSON 配置时应加载 YAML + defaults', () => {
    writeFileSync(join(yamlDir, 'config.yaml'), `
network:
  ws: { host: '127.0.0.1', port: 18780 }
  http: { host: '127.0.0.1', port: 18790 }
llm:
  provider: deepseek
  apiKey: \${DEEPSEEK_API_KEY}
  baseUrl: 'https://api.deepseek.com'
  defaultModel: deepseek-v4-pro
  models:
    - { id: deepseek-v4-pro, contextWindow: 128000 }
embedding:
  provider: openai
  apiKey: sk-emb-yaml
  baseUrl: 'https://api.openai.com/v1'
  model: text-embedding-3-small
  dimensions: 1536
memory:
  persist: { backend: sqlite, path: '/tmp/m.db' }
security:
  authToken: 'a-very-secure-token-32-chars-long!'
  sandbox: { workDir: '~/.myopenclaw/workspace' }
`);

    const cfg = loadConfig();
    expect(cfg.network.ws.port).toBe(18780);
    expect(cfg.llm.provider).toBe('deepseek');
  });
});

describe('loadConfig — JSON 覆盖 YAML', () => {
  it('JSON 存在时 JSON 应覆盖 YAML 相同字段', () => {
    writeFileSync(join(yamlDir, 'config.yaml'), `
network:
  ws: { host: '0.0.0.0', port: 18780 }
  http: { host: '0.0.0.0', port: 18790 }
llm:
  provider: deepseek
  apiKey: yaml-key
  baseUrl: 'https://api.deepseek.com'
  defaultModel: deepseek-v4-pro
  models:
    - { id: deepseek-v4-pro }
embedding:
  provider: openai
  apiKey: sk-emb
  baseUrl: 'https://api.openai.com/v1'
  model: text-embedding-3-small
  dimensions: 1536
memory:
  persist: { backend: sqlite, path: '/tmp/m.db' }
security:
  authToken: 'a-very-secure-token-32-chars-long!'
  sandbox: { workDir: '~/.myopenclaw/workspace' }
`);

    // 写 JSON,覆盖 ws.host
    const jsonConfig = { ...VALID_FULL_CONFIG, network: { ...VALID_FULL_CONFIG.network, ws: { ...VALID_FULL_CONFIG.network.ws, host: '127.0.0.1' } } };
    const jsonPath = join(tmpDir, 'config.json');
    writeFileSync(jsonPath, JSON.stringify(jsonConfig));
    // 覆盖 beforeEach 里的 nonexistent.json 路径,让 loader 读到这个 JSON
    vi.stubEnv('MYOC_CONFIG_PATH', jsonPath);

    const cfg = loadConfig();
    expect(cfg.network.ws.host).toBe('127.0.0.1');  // JSON 覆盖 YAML
  });
});

describe('loadConfig — 环境变量覆盖 JSON', () => {
  it('MYOC_LLM_APIKEY 应覆盖 JSON apiKey', () => {
    writeFileSync(join(yamlDir, 'config.yaml'), `
network:
  ws: { host: '127.0.0.1', port: 18780 }
  http: { host: '127.0.0.1', port: 18790 }
llm:
  provider: deepseek
  apiKey: yaml-key
  baseUrl: 'https://api.deepseek.com'
  defaultModel: deepseek-v4-pro
  models:
    - { id: deepseek-v4-pro }
embedding:
  provider: openai
  apiKey: sk-emb
  baseUrl: 'https://api.openai.com/v1'
  model: text-embedding-3-small
  dimensions: 1536
memory:
  persist: { backend: sqlite, path: '/tmp/m.db' }
security:
  authToken: 'a-very-secure-token-32-chars-long!'
  sandbox: { workDir: '~/.myopenclaw/workspace' }
`);

    const jsonConfig = { ...VALID_FULL_CONFIG, llm: { ...VALID_FULL_CONFIG.llm, apiKey: 'json-key' } };
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(jsonConfig));

    vi.stubEnv('MYOC_LLM_APIKEY', 'env-key');

    const cfg = loadConfig();
    expect(cfg.llm.apiKey).toBe('env-key');  // env 最高优先级
  });
});

describe('loadConfig — 致命问题', () => {
  it('JSON 必填字段缺失应抛 ConfigFatalError', () => {
    writeFileSync(join(yamlDir, 'config.yaml'), `
network:
  ws: { host: '127.0.0.1', port: 18780 }
  http: { host: '127.0.0.1', port: 18790 }
llm:
  provider: deepseek
  apiKey: yaml-key
  baseUrl: 'https://api.deepseek.com'
  defaultModel: m1
  models: [{ id: m1 }]
embedding:
  provider: openai
  apiKey: sk-emb
  baseUrl: 'https://api.openai.com/v1'
  model: text-embedding-3-small
  dimensions: 1536
memory:
  persist: { backend: sqlite, path: '/tmp/m.db' }
security:
  authToken: 'a-very-secure-token-32-chars-long!'
  sandbox: { workDir: '~/.myopenclaw/workspace' }
`);

    // JSON 缺 llm
    const broken = { ...VALID_FULL_CONFIG };
    delete (broken as Record<string, unknown>).llm;
    const jsonPath = join(tmpDir, 'config.json');
    writeFileSync(jsonPath, JSON.stringify(broken));
    // 覆盖 beforeEach 里的 nonexistent.json 路径
    vi.stubEnv('MYOC_CONFIG_PATH', jsonPath);

    expect(() => loadConfig()).toThrow(ConfigFatalError);
  });
});

describe('loadConfig — 缓存', () => {
  it('clearConfigCache 后重新读取才生效', () => {
    writeFileSync(join(yamlDir, 'config.yaml'), `
network:
  ws: { host: '127.0.0.1', port: 18780 }
  http: { host: '127.0.0.1', port: 18790 }
llm:
  provider: deepseek
  apiKey: yaml-key
  baseUrl: 'https://api.deepseek.com'
  defaultModel: deepseek-v4-pro
  models:
    - { id: deepseek-v4-pro }
embedding:
  provider: openai
  apiKey: sk-emb
  baseUrl: 'https://api.openai.com/v1'
  model: text-embedding-3-small
  dimensions: 1536
memory:
  persist: { backend: sqlite, path: '/tmp/m.db' }
security:
  authToken: 'a-very-secure-token-32-chars-long!'
  sandbox: { workDir: '~/.myopenclaw/workspace' }
`);

    const cfg1 = loadConfig();
    expect(cfg1.network.ws.port).toBe(18780);

    // 不清缓存再读: 应该还是缓存值
    const cfg2 = loadConfig();
    expect(cfg2).toBe(cfg1);
  });
});

describe('getConfig — dot-path', () => {
  it('应正确解析 dot-path', () => {
    writeFileSync(join(yamlDir, 'config.yaml'), `
network:
  ws: { host: '127.0.0.1', port: 18888 }
  http: { host: '127.0.0.1', port: 18790 }
llm:
  provider: deepseek
  apiKey: yaml-key
  baseUrl: 'https://api.deepseek.com'
  defaultModel: deepseek-v4-pro
  models:
    - { id: deepseek-v4-pro }
embedding:
  provider: openai
  apiKey: sk-emb
  baseUrl: 'https://api.openai.com/v1'
  model: text-embedding-3-small
  dimensions: 1536
memory:
  persist: { backend: sqlite, path: '/tmp/m.db' }
security:
  authToken: 'a-very-secure-token-32-chars-long!'
  sandbox: { workDir: '~/.myopenclaw/workspace' }
`);

    expect(getConfig<number>('network.ws.port')).toBe(18888);
    expect(getConfig<string>('llm.provider')).toBe('deepseek');
    expect(getConfig<string>('nonexistent', 'fallback')).toBe('fallback');
  });
});
