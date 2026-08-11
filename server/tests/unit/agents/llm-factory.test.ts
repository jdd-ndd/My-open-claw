/**
 * LLMAdapterFactory 单元测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LLMAdapterFactory } from '../../../src/agents/llm/factory.js';
import { DeepSeekAdapter } from '../../../src/agents/llm/deepseek.js';
import { OpenAIAdapter } from '../../../src/agents/llm/openai.js';
import { ClaudeAdapter } from '../../../src/agents/llm/claude.js';
import { LocalLLMAdapter } from '../../../src/agents/llm/local.js';
import { LLMError } from '../../../src/agents/llm/errors.js';
import type { LLMAdapter } from '../../../src/agents/llm/types.js';

describe('agents/llm - LLMAdapterFactory', () => {
  const savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    savedEnv.DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    savedEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    savedEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    // 清理注册表
    for (const p of LLMAdapterFactory.listCustomProviders()) {
      LLMAdapterFactory.unregister(p);
    }
  });

  describe('create 内置厂商', () => {
    it('应创建 DeepSeekAdapter', () => {
      const adapter = LLMAdapterFactory.create({
        provider: 'deepseek',
        model: 'deepseek-chat',
        apiKey: 'sk-test',
      });
      expect(adapter).toBeInstanceOf(DeepSeekAdapter);
      expect(adapter.provider).toBe('deepseek');
      expect(adapter.model).toBe('deepseek-chat');
      expect(adapter.id).toBe('deepseek:deepseek-chat');
    });

    it('应创建 OpenAIAdapter', () => {
      const adapter = LLMAdapterFactory.create({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk-test',
      });
      expect(adapter).toBeInstanceOf(OpenAIAdapter);
      expect(adapter.provider).toBe('openai');
    });

    it('应创建 ClaudeAdapter', () => {
      const adapter = LLMAdapterFactory.create({
        provider: 'claude',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'sk-ant-test',
      });
      expect(adapter).toBeInstanceOf(ClaudeAdapter);
      expect(adapter.provider).toBe('claude');
    });

    it('应创建 LocalLLMAdapter', () => {
      const adapter = LLMAdapterFactory.create({
        provider: 'local',
        model: 'llama3.1:8b',
      });
      expect(adapter).toBeInstanceOf(LocalLLMAdapter);
      expect(adapter.provider).toBe('local');
      // 本地模型默认不支持 tool calls
      expect(adapter.supportsToolCalls).toBe(false);
    });

    it('应允许自定义 baseUrl', () => {
      const adapter = LLMAdapterFactory.create({
        provider: 'deepseek',
        model: 'deepseek-chat',
        apiKey: 'sk',
        baseUrl: 'https://proxy.example.com/v1',
      });
      expect(adapter).toBeInstanceOf(DeepSeekAdapter);
    });

    it('应支持自定义 displayName', () => {
      const adapter = LLMAdapterFactory.create({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk',
        displayName: 'My GPT-4o',
      });
      expect(adapter.displayName).toBe('My GPT-4o');
    });

    it('应使用 OpenAI 模型表中的上下文窗口', () => {
      const adapter = LLMAdapterFactory.create({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk',
      });
      expect(adapter.contextWindow).toBe(128_000);
    });

    it('应允许覆盖上下文窗口', () => {
      const adapter = LLMAdapterFactory.create({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'sk',
        contextWindow: 32_768,
      });
      expect(adapter.contextWindow).toBe(32_768);
    });
  });

  describe('create 校验与错误', () => {
    it('缺少 provider 时应抛错', () => {
      expect(() =>
        LLMAdapterFactory.create({ provider: '' as never, model: 'm' }),
      ).toThrow(LLMError);
    });

    it('缺少 model 时应抛错', () => {
      expect(() =>
        LLMAdapterFactory.create({ provider: 'deepseek', model: '' }),
      ).toThrow(/model/);
    });

    it('未知 provider 时应抛错', () => {
      expect(() =>
        LLMAdapterFactory.create({ provider: 'unknown' as never, model: 'm', apiKey: 'k' }),
      ).toThrow(/不支持的 LLM 提供商/);
    });
  });

  describe('register / unregister', () => {
    it('应注册并使用自定义提供商', () => {
      class CustomAdapter implements LLMAdapter {
        readonly id = 'custom:test';
        readonly displayName = 'Custom';
        readonly provider = 'custom' as const;
        readonly model = 'm';
        readonly supportsToolCalls = false;
        readonly supportsStreaming = false;
        readonly contextWindow = 4096;
        async chat() {
          return {
            content: '',
            finishReason: 'stop' as const,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            model: 'm',
          };
        }
        async *streamChat() {
          yield { delta: '', done: true };
        }
        async embed() {
          return [];
        }
        async countTokens() {
          return 0;
        }
      }
      LLMAdapterFactory.register('custom', (cfg) => new CustomAdapter());
      const adapter = LLMAdapterFactory.create({
        provider: 'custom' as never,
        model: 'm',
        apiKey: 'k',
      });
      expect(adapter).toBeInstanceOf(CustomAdapter);
      expect(LLMAdapterFactory.listCustomProviders()).toContain('custom');

      LLMAdapterFactory.unregister('custom');
      expect(LLMAdapterFactory.listCustomProviders()).not.toContain('custom');
    });
  });

  describe('resolveApiKey', () => {
    it('应使用显式传入的密钥', () => {
      expect(LLMAdapterFactory.resolveApiKey('deepseek', 'sk-explicit')).toBe('sk-explicit');
    });

    it('应支持 ${VAR_NAME} 环境变量引用', () => {
      process.env.MY_TEST_KEY = 'sk-from-env';
      expect(LLMAdapterFactory.resolveApiKey('deepseek', '${MY_TEST_KEY}')).toBe('sk-from-env');
      delete process.env.MY_TEST_KEY;
    });

    it('应回退到默认环境变量', () => {
      process.env.DEEPSEEK_API_KEY = 'sk-deepseek';
      process.env.OPENAI_API_KEY = 'sk-openai';
      process.env.ANTHROPIC_API_KEY = 'sk-anthropic';
      expect(LLMAdapterFactory.resolveApiKey('deepseek')).toBe('sk-deepseek');
      expect(LLMAdapterFactory.resolveApiKey('openai')).toBe('sk-openai');
      expect(LLMAdapterFactory.resolveApiKey('claude')).toBe('sk-anthropic');
    });
  });

  describe('fromAgentConfig', () => {
    it('应从字典形式的配置创建适配器', () => {
      const adapter = LLMAdapterFactory.fromAgentConfig({
        llm: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          apiKey: 'sk-x',
          options: { temperature: 0.5 },
        },
      });
      expect(adapter).toBeInstanceOf(OpenAIAdapter);
      expect(adapter.model).toBe('gpt-4o-mini');
    });

    it('无 llm 段时应使用默认值（deepseek-chat）', () => {
      const adapter = LLMAdapterFactory.fromAgentConfig({});
      expect(adapter.provider).toBe('deepseek');
      expect(adapter.model).toBe('deepseek-chat');
    });
  });
});