/**
 * 启动期校验器测试
 */

import { describe, it, expect } from 'vitest';
import { validateStartupConfig } from '../../../src/core/config/validator.js';
import { ConfigFatalError } from '../../../src/core/config/errors.js';
import type { MyOpenClawConfig } from '../../../src/core/config/types.js';

function makeValidConfig(overrides: Record<string, unknown> = {}): MyOpenClawConfig {
  return {
    app: { name: 'myopenclaw', mode: 'production' },
    network: {
      ws: { host: '127.0.0.1', port: 18780, path: '/ws' },
      http: { host: '127.0.0.1', port: 18790, basePath: '' },
      timeout: {
        connectMs: 10_000, readMs: 30_000, idleMs: 120_000,
        requestMs: 60_000, shutdownMs: 10_000,
      },
      pool: {
        maxConnections: 100, maxConnectionsPerHost: 16,
        keepAliveMs: 60_000, keepAliveTimeoutMs: 30_000,
        maxIdleConnections: 16, pipelineDepth: 1,
      },
      cors: { origins: ['http://localhost:3000'], credentials: true, maxAgeSeconds: 86_400 },
      tls: { enabled: false, certPath: '~/certs/server.crt', keyPath: '~/certs/server.key', minVersion: 'TLSv1.2' },
    },
    llm: {
      provider: 'deepseek',
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com',
      defaultModel: 'm1',
      models: [{ id: 'm1', contextWindow: 128_000, maxOutputTokens: 8_192 }],
      modelParams: {
        temperature: 0.7, topP: 0.9, frequencyPenalty: 0, presencePenalty: 0,
        maxTokens: 4_096, stopSequences: [], reasoningEffort: 'high',
      },
      rateLimit: { requestsPerMinute: 60, tokensPerMinute: 100_000, concurrent: 16, burstMultiplier: 1.5 },
      retry: { maxRetries: 2, initialBackoffMs: 500, maxBackoffMs: 10_000, backoffMultiplier: 2.0, retryableStatusCodes: [429, 500, 502, 503, 504] },
      streaming: { enabled: true, includeUsage: true },
      proxy: { enabled: false, url: '' },
    },
    embedding: {
      provider: 'openai',
      apiKey: 'sk-emb',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      batchSize: 64,
    },
    memory: {
      session: { maxMessages: 50, ttlSeconds: 86_400 },
      vector: { backend: 'local', dimension: 1536, distance: 'cosine' },
      persist: { backend: 'sqlite', path: '/tmp/m.db' },
    },
    security: {
      authToken: 'a-very-secure-token-32-chars-long!',
      apiRateLimit: { windowMs: 60_000, max: 120 },
      sandbox: { workDir: '~/.myopenclaw/workspace', maxMemoryMb: 512, timeoutMs: 30_000, allowNetwork: true },
      tools: {
        allowedPaths: [], blockedCommands: [], requireConfirmation: [],
        maxExecutionTimeMs: 60_000, maxFileOperationBytes: 10_485_760,
      },
    },
    paths: {
      data: '~/.myopenclaw/data', logs: '~/.myopenclaw/logs',
      workspace: '~/.myopenclaw/workspace', skills: './skills',
      pidFile: '~/.myopenclaw/server.pid',
    },
    logging: {
      level: 'info', format: 'pretty', output: 'console',
      file: '~/.myopenclaw/logs/server.log',
      rotation: { enabled: true, maxSizeMb: 50, maxFiles: 10, compress: true },
    },
    agents: { maxConcurrent: 8 },
    features: { scheduler: true, audit: true, rateLimit: true, memory: true, vectorSearch: true, streaming: true },
    ...overrides,
  } as unknown as MyOpenClawConfig;
}

describe('validateStartupConfig — 合法配置', () => {
  it('完整有效配置不抛错', () => {
    expect(() => validateStartupConfig(makeValidConfig())).not.toThrow();
  });
});

describe('validateStartupConfig — 跨字段冲突', () => {
  it('ws.port == http.port 应抛 ConfigFatalError', () => {
    const cfg = makeValidConfig();
    cfg.network.ws.port = 18790;
    expect(() => validateStartupConfig(cfg)).toThrow(ConfigFatalError);
  });

  it('ws.port ≠ http.port 应通过', () => {
    const cfg = makeValidConfig();
    expect(cfg.network.ws.port).not.toBe(cfg.network.http.port);
    expect(() => validateStartupConfig(cfg)).not.toThrow();
  });
});

describe('validateStartupConfig — authToken 强度', () => {
  it('authToken = "please-change-me" 应被拒绝', () => {
    const cfg = makeValidConfig();
    cfg.security.authToken = 'please-change-me';
    try {
      validateStartupConfig(cfg);
      expect.fail('should throw');
    } catch (err) {
      const e = err as ConfigFatalError;
      expect(e.issues.some((i) => i.path === 'security.authToken' && i.message.includes('占位符'))).toBe(true);
    }
  });

  it('生产模式 authToken < 32 字符应被拒绝', () => {
    const cfg = makeValidConfig();
    cfg.security.authToken = 'a-16-chars-token!';  // 18 字符
    try {
      validateStartupConfig(cfg);
      expect.fail('should throw');
    } catch (err) {
      const e = err as ConfigFatalError;
      expect(e.issues.some((i) => i.path === 'security.authToken')).toBe(true);
    }
  });

  it('开发模式 authToken 16 字符可过(非生产宽松)', () => {
    const cfg = makeValidConfig();
    cfg.app.mode = 'development';
    cfg.security.authToken = 'a-16-chars-token!';
    expect(() => validateStartupConfig(cfg)).not.toThrow();
  });
});

describe('validateStartupConfig — LLM 引用一致性', () => {
  it('llm.defaultModel 不在 models 列表中应失败', () => {
    const cfg = makeValidConfig();
    cfg.llm.defaultModel = 'not-in-list';
    try {
      validateStartupConfig(cfg);
      expect.fail('should throw');
    } catch (err) {
      const e = err as ConfigFatalError;
      expect(e.issues.some((i) => i.path === 'llm.defaultModel')).toBe(true);
    }
  });

  it('llm.defaultModel == models[0].id 应通过', () => {
    const cfg = makeValidConfig();
    expect(cfg.llm.defaultModel).toBe(cfg.llm.models[0]!.id);
    expect(() => validateStartupConfig(cfg)).not.toThrow();
  });

  it('provider=ollama 但 apiKey 为空应通过', () => {
    const cfg = makeValidConfig();
    cfg.llm.provider = 'ollama';
    cfg.llm.apiKey = '';
    expect(() => validateStartupConfig(cfg)).not.toThrow();
  });

  it('provider=deepseek 但 apiKey 为空应失败', () => {
    const cfg = makeValidConfig();
    cfg.llm.apiKey = '';
    try {
      validateStartupConfig(cfg);
      expect.fail('should throw');
    } catch (err) {
      const e = err as ConfigFatalError;
      expect(e.issues.some((i) => i.path === 'llm.apiKey')).toBe(true);
    }
  });

  it('llm.proxy.enabled=true 但 url 空应失败', () => {
    const cfg = makeValidConfig();
    cfg.llm.proxy.enabled = true;
    cfg.llm.proxy.url = '';
    try {
      validateStartupConfig(cfg);
      expect.fail('should throw');
    } catch (err) {
      const e = err as ConfigFatalError;
      expect(e.issues.some((i) => i.path === 'llm.proxy.url')).toBe(true);
    }
  });
});

describe('validateStartupConfig — Embedding 必填', () => {
  it('embedding.provider=openai 但 apiKey 空应失败', () => {
    const cfg = makeValidConfig();
    cfg.embedding.provider = 'openai';
    cfg.embedding.apiKey = '';
    try {
      validateStartupConfig(cfg);
      expect.fail('should throw');
    } catch (err) {
      const e = err as ConfigFatalError;
      expect(e.issues.some((i) => i.path === 'embedding.apiKey')).toBe(true);
    }
  });

  it('embedding.provider=local 但 apiKey 空应通过', () => {
    const cfg = makeValidConfig();
    cfg.embedding.provider = 'local';
    cfg.embedding.apiKey = '';
    expect(() => validateStartupConfig(cfg)).not.toThrow();
  });
});

describe('validateStartupConfig — 错误格式', () => {
  it('抛错时 format() 应输出可读多行文本', () => {
    const cfg = makeValidConfig();
    cfg.network.ws.port = cfg.network.http.port;
    try {
      validateStartupConfig(cfg);
      expect.fail('should throw');
    } catch (err) {
      const e = err as ConfigFatalError;
      const formatted = e.format();
      expect(formatted).toContain('MyOpenClaw 配置加载失败');
      expect(formatted).toContain('✗');
      expect(formatted).toContain('提示');
    }
  });
});
