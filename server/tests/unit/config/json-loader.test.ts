/**
 * JSON 加载器测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadJsonConfig } from '../../../src/core/config/json-loader.js';
import { ConfigFatalError } from '../../../src/core/config/errors.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'myoc-test-'));
  vi.stubEnv('MYOC_CONFIG_PATH', join(tmpDir, 'config.json'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

const validConfig = {
  network: {
    ws: { host: '127.0.0.1', port: 18780, path: '/ws' },
    http: { host: '127.0.0.1', port: 18790, basePath: '' },
  },
  llm: {
    provider: 'deepseek',
    apiKey: 'sk-test-1234',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'm1',
    models: [{ id: 'm1', contextWindow: 128000, maxOutputTokens: 8192 }],
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

describe('loadJsonConfig — 文件存在', () => {
  it('合法 JSON 应通过校验并返回数据', () => {
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(validConfig));
    const result = loadJsonConfig();
    expect(result).not.toBeNull();
    expect(result?.llm.provider).toBe('deepseek');
    expect(result?.network.ws.port).toBe(18780);
  });

  it('应用了 schema 的默认值', () => {
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(validConfig));
    const result = loadJsonConfig();
    expect(result?.app.name).toBe('myopenclaw');
    expect(result?.app.mode).toBe('production');
  });
});

describe('loadJsonConfig — 文件不存在', () => {
  it('MYOC_CONFIG_PATH 指向不存在的文件应返回 null', () => {
    // 没创建 config.json
    const result = loadJsonConfig();
    expect(result).toBeNull();
  });
});

describe('loadJsonConfig — JSON 格式错误', () => {
  it('损坏的 JSON 应抛 ConfigFatalError', () => {
    writeFileSync(join(tmpDir, 'config.json'), '{ invalid json');
    expect(() => loadJsonConfig()).toThrow(ConfigFatalError);
  });

  it('错误信息应包含文件名', () => {
    writeFileSync(join(tmpDir, 'config.json'), '{ broken');
    try {
      loadJsonConfig();
    } catch (err) {
      const e = err as ConfigFatalError;
      expect(e.issues[0]?.path).toContain('config.json');
      expect(e.issues[0]?.message).toContain('JSON');
    }
  });
});

describe('loadJsonConfig — Schema 校验失败', () => {
  it('缺必填字段应抛 ConfigFatalError,包含字段路径', () => {
    const broken = { ...validConfig };
    delete (broken as Record<string, unknown>).llm;
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(broken));
    try {
      loadJsonConfig();
      expect.fail('should throw');
    } catch (err) {
      const e = err as ConfigFatalError;
      expect(e.issues.length).toBeGreaterThan(0);
      expect(e.issues.some((i) => i.path.includes('llm'))).toBe(true);
    }
  });

  it('字段类型错应抛错', () => {
    const broken = {
      ...validConfig,
      network: {
        ...validConfig.network,
        ws: { ...validConfig.network.ws, port: 'not-a-number' },
      },
    };
    writeFileSync(join(tmpDir, 'config.json'), JSON.stringify(broken));
    expect(() => loadJsonConfig()).toThrow(ConfigFatalError);
  });
});
