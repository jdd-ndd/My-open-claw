/**
 * Zod Schema 边界测试
 */

import { describe, it, expect } from 'vitest';
import { MyOpenClawConfigSchema } from '../../../src/core/config/schema.js';

const VALID_NETWORK = {
  ws: { host: '127.0.0.1', port: 18780, path: '/ws' },
  http: { host: '127.0.0.1', port: 18790, basePath: '' },
};

const VALID_LLM = {
  provider: 'deepseek' as const,
  apiKey: 'sk-test',
  baseUrl: 'https://api.deepseek.com',
  defaultModel: 'm1',
  models: [{ id: 'm1', contextWindow: 128000, maxOutputTokens: 8192 }],
};

const VALID_EMBEDDING = {
  provider: 'openai' as const,
  apiKey: 'sk-emb',
  baseUrl: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  dimensions: 1536,
};

const VALID_MEMORY = {
  persist: { backend: 'sqlite' as const, path: '/tmp/m.db' },
};

const VALID_SECURITY = {
  authToken: 'a-very-secure-token-32-chars-long!',
  sandbox: { workDir: '~/.myopenclaw/workspace' },
};

const baseConfig = {
  network: VALID_NETWORK,
  llm: VALID_LLM,
  embedding: VALID_EMBEDDING,
  memory: VALID_MEMORY,
  security: VALID_SECURITY,
};

describe('MyOpenClawConfigSchema — 合法配置', () => {
  it('最小完整配置应通过', () => {
    const result = MyOpenClawConfigSchema.safeParse(baseConfig);
    expect(result.success).toBe(true);
  });

  it('空 input 应被 defaults 补全后通过', () => {
    const result = MyOpenClawConfigSchema.safeParse({
      ...baseConfig,
      app: {},  // 显式空对象
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.app.name).toBe('myopenclaw');
      expect(result.data.app.mode).toBe('production');
    }
  });

  it('只声明 overrides 字段应被 schema 默认补全其他字段', () => {
    const result = MyOpenClawConfigSchema.safeParse({
      ...baseConfig,
      llm: {
        ...VALID_LLM,
        modelParams: { temperature: 0.3 },  // 只覆盖一个
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.llm.modelParams.temperature).toBe(0.3);
      expect(result.data.llm.modelParams.topP).toBe(0.9);  // 默认
    }
  });
});

describe('MyOpenClawConfigSchema — 字段校验', () => {
  it('ws.port 越界应失败', () => {
    const result = MyOpenClawConfigSchema.safeParse({
      ...baseConfig,
      network: { ...VALID_NETWORK, ws: { ...VALID_NETWORK.ws, port: 99999 } },
    });
    expect(result.success).toBe(false);
  });

  it('llm.apiKey 缺失应失败(provider≠ollama)', () => {
    const result = MyOpenClawConfigSchema.safeParse({
      ...baseConfig,
      llm: { ...VALID_LLM, apiKey: '' },
    });
    expect(result.success).toBe(false);
  });

  it('llm.provider=ollama 时 apiKey 可空', () => {
    const result = MyOpenClawConfigSchema.safeParse({
      ...baseConfig,
      llm: { ...VALID_LLM, provider: 'ollama', apiKey: '' },
    });
    expect(result.success).toBe(true);
  });

  it('temperature 越界应失败', () => {
    const result = MyOpenClawConfigSchema.safeParse({
      ...baseConfig,
      llm: {
        ...VALID_LLM,
        modelParams: { temperature: 5 },
      },
    });
    expect(result.success).toBe(false);
  });

  it('authToken 长度 < 16 应失败', () => {
    const result = MyOpenClawConfigSchema.safeParse({
      ...baseConfig,
      security: { ...VALID_SECURITY, authToken: 'short' },
    });
    expect(result.success).toBe(false);
  });

  it('logging.file 在 output≠console 时可空 — schema 内部 refine 会失败', () => {
    const result = MyOpenClawConfigSchema.safeParse({
      ...baseConfig,
      logging: { output: 'file', file: '' },
    });
    expect(result.success).toBe(false);
  });

  it('models 列表为空应失败', () => {
    const result = MyOpenClawConfigSchema.safeParse({
      ...baseConfig,
      llm: { ...VALID_LLM, models: [] },
    });
    expect(result.success).toBe(false);
  });

  it('provider 非法枚举应失败', () => {
    const result = MyOpenClawConfigSchema.safeParse({
      ...baseConfig,
      llm: { ...VALID_LLM, provider: 'gpt-99' as never },
    });
    expect(result.success).toBe(false);
  });
});
