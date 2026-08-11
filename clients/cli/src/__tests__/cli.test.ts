/**
 * CLI 客户端核心功能单元测试
 *
 * 覆盖以下模块：
 * - 配置管理（schema, loader）
 * - API 类型定义
 * - 工具函数（output, errors, stdin）
 * - 命令解析
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConfigSchema, type MyOpenClawConfig } from '../config/schema.js';
import { parseConfigValue, getConfigValue, setConfigValue } from '../config/loader.js';
import { ExitCode, formatError, createOperationError } from '../utils/errors.js';
import { OutputFormatter, createFormatter } from '../utils/output.js';
import { randomUUID } from 'node:crypto';

// ═══════════════════════════════════════
// 配置 Schema 测试
// ═══════════════════════════════════════

describe('配置 Schema', () => {
  it('应能正确解析默认配置', () => {
    const config = ConfigSchema.parse({});
    expect(config.gateway.url).toBe('http://localhost:18780');
    expect(config.model.default).toBe('gpt-4o');
    expect(config.model.temperature).toBe(0.7);
    expect(config.model.maxTokens).toBe(4096);
    expect(config.channel.default).toBe('myopenclaw');
    expect(config.cli.outputFormat).toBe('text');
    expect(config.cli.timeout).toBe(60);
    expect(config.cli.enableColors).toBe(true);
  });

  it('应能正确解析自定义配置', () => {
    const config = ConfigSchema.parse({
      gateway: {
        url: 'https://custom-gateway.example.com',
        websocketUrl: 'wss://custom-gateway.example.com',
      },
      model: {
        default: 'claude-3.5',
        temperature: 0.5,
        maxTokens: 8192,
      },
      channel: {
        default: 'production',
      },
      cli: {
        outputFormat: 'json',
        timeout: 30,
        historySize: 50,
        enableColors: false,
      },
    });

    expect(config.gateway.url).toBe('https://custom-gateway.example.com');
    expect(config.gateway.websocketUrl).toBe('wss://custom-gateway.example.com');
    expect(config.model.default).toBe('claude-3.5');
    expect(config.model.temperature).toBe(0.5);
    expect(config.model.maxTokens).toBe(8192);
    expect(config.channel.default).toBe('production');
    expect(config.cli.outputFormat).toBe('json');
    expect(config.cli.timeout).toBe(30);
    expect(config.cli.historySize).toBe(50);
    expect(config.cli.enableColors).toBe(false);
  });

  it('温度参数应接受 0-2 范围', () => {
    const config0 = ConfigSchema.parse({ model: { temperature: 0 } });
    expect(config0.model.temperature).toBe(0);

    const config2 = ConfigSchema.parse({ model: { temperature: 2 } });
    expect(config2.model.temperature).toBe(2);

    expect(() => {
      ConfigSchema.parse({ model: { temperature: -0.1 } });
    }).toThrow();

    expect(() => {
      ConfigSchema.parse({ model: { temperature: 2.1 } });
    }).toThrow();
  });

  it('超时参数应接受正整数', () => {
    const config = ConfigSchema.parse({ cli: { timeout: 1 } });
    expect(config.cli.timeout).toBe(1);

    expect(() => {
      ConfigSchema.parse({ cli: { timeout: 0 } });
    }).toThrow();

    expect(() => {
      ConfigSchema.parse({ cli: { timeout: -1 } });
    }).toThrow();
  });

  it('输出格式应接受有效枚举值', () => {
    expect(ConfigSchema.parse({ cli: { outputFormat: 'text' } }).cli.outputFormat).toBe('text');
    expect(ConfigSchema.parse({ cli: { outputFormat: 'json' } }).cli.outputFormat).toBe('json');
    expect(ConfigSchema.parse({ cli: { outputFormat: 'table' } }).cli.outputFormat).toBe('table');

    expect(() => {
      ConfigSchema.parse({ cli: { outputFormat: 'invalid' } });
    }).toThrow();
  });

  it('URL 应验证格式', () => {
    expect(() => {
      ConfigSchema.parse({ gateway: { url: 'not-a-url' } });
    }).toThrow();
  });
});

// ═══════════════════════════════════════
// 配置操作工具测试
// ═══════════════════════════════════════

describe('配置操作工具', () => {
  it('应正确解析字符串值类型', () => {
    expect(parseConfigValue('true')).toBe(true);
    expect(parseConfigValue('false')).toBe(false);
    expect(parseConfigValue('42')).toBe(42);
    expect(parseConfigValue('3.14')).toBe(3.14);
    expect(parseConfigValue('hello')).toBe('hello');
  });

  it('应正确获取嵌套配置值', () => {
    const config: MyOpenClawConfig = ConfigSchema.parse({});

    expect(getConfigValue(config, 'gateway.url')).toBe('http://localhost:18780');
    expect(getConfigValue(config, 'model.default')).toBe('gpt-4o');
    expect(getConfigValue(config, 'model.temperature')).toBe(0.7);
    expect(getConfigValue(config, 'cli.timeout')).toBe(60);
    expect(getConfigValue(config, 'nonexistent.key')).toBeUndefined();
  });

  it('应正确设置嵌套配置值', () => {
    const config: Record<string, unknown> = {
      gateway: { url: 'old-url' },
    };

    setConfigValue(config, 'gateway.url', 'new-url');
    expect((config.gateway as Record<string, unknown>).url).toBe('new-url');

    setConfigValue(config, 'new.nested.key', 'value');
    expect(((config.new as Record<string, unknown>).nested as Record<string, unknown>).key).toBe('value');
  });
});

// ═══════════════════════════════════════
// 错误处理工具测试
// ═══════════════════════════════════════

describe('错误处理工具', () => {
  it('ExitCode 应包含所有标准退出码', () => {
    expect(ExitCode.SUCCESS).toBe(0);
    expect(ExitCode.GENERAL_ERROR).toBe(1);
    expect(ExitCode.USAGE_ERROR).toBe(2);
    expect(ExitCode.GATEWAY_UNREACHABLE).toBe(3);
    expect(ExitCode.GATEWAY_ERROR).toBe(4);
    expect(ExitCode.TIMEOUT).toBe(5);
    expect(ExitCode.CONFIG_ERROR).toBe(6);
    expect(ExitCode.PERMISSION_ERROR).toBe(7);
    expect(ExitCode.USER_INTERRUPTED).toBe(130);
  });

  it('应格式化 CliError', async () => {
    const { CliError } = await import('../utils/errors.js');
    const error = new CliError('测试错误', { code: 1, retryable: true });
    const formatted = formatError(error);
    expect(formatted).toContain('测试错误');
    expect(formatted).toContain('可重试');
  });

  it('应格式化标准 Error', () => {
    const error = new Error('标准错误消息');
    const formatted = formatError(error);
    expect(formatted).toContain('标准错误消息');
  });

  it('应格式化未知错误', () => {
    const formatted = formatError('字符串错误');
    expect(formatted).toContain('字符串错误');
  });

  it('createOperationError 应生成格式化消息', () => {
    const error = new Error('连接超时');
    const message = createOperationError('发送消息', error);
    expect(message).toContain('发送消息失败');
    expect(message).toContain('连接超时');
  });
});

// ═══════════════════════════════════════
// 输出格式化器测试
// ═══════════════════════════════════════

describe('输出格式化器', () => {
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let capturedOutput: string[];
  let capturedError: string[];

  beforeAll(() => {
    originalLog = console.log;
    originalError = console.error;
    capturedOutput = [];
    capturedError = [];
    console.log = (...args: unknown[]) => {
      capturedOutput.push(args.join(' '));
    };
    console.error = (...args: unknown[]) => {
      capturedError.push(args.join(' '));
    };
  });

  afterAll(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  beforeEach(() => {
    capturedOutput = [];
    capturedError = [];
  });

  it('应创建默认格式化器（文本模式）', () => {
    const formatter = createFormatter();
    expect(formatter.format).toBe('text');
  });

  it('应创建 JSON 格式化器', () => {
    const formatter = createFormatter('json');
    expect(formatter.format).toBe('json');
  });

  it('应以 JSON 格式输出', () => {
    const formatter = new OutputFormatter('json');
    formatter.print({ key: 'value', number: 42 });

    expect(capturedOutput.length).toBeGreaterThan(0);
    const output = JSON.parse(capturedOutput.join('\n'));
    expect(output.key).toBe('value');
    expect(output.number).toBe(42);
  });

  it('应以文本格式输出字符串', () => {
    const formatter = new OutputFormatter('text');
    formatter.print('Hello World');

    expect(capturedOutput).toContain('Hello World');
  });

  it('应以文本格式输出对象', () => {
    const formatter = new OutputFormatter('text');
    formatter.print({ nested: { data: 'test' } });

    expect(capturedOutput.length).toBeGreaterThan(0);
  });

  it('应输出成功消息', () => {
    const formatter = new OutputFormatter('text');
    formatter.success('操作完成');

    const output = capturedOutput.join(' ');
    expect(output).toContain('✓');
    expect(output).toContain('操作完成');
  });

  it('应输出错误消息', () => {
    const formatter = new OutputFormatter('text');
    formatter.error('操作失败');

    const output = capturedError.join(' ');
    expect(output).toContain('✗');
    expect(output).toContain('操作失败');
  });

  it('应输出警告消息', () => {
    const formatter = new OutputFormatter('text');
    formatter.warning('警告信息');

    const output = capturedOutput.join(' ');
    expect(output).toContain('⚠');
    expect(output).toContain('警告信息');
  });

  it('应输出信息消息', () => {
    const formatter = new OutputFormatter('text');
    formatter.info('提示信息');

    const output = capturedOutput.join(' ');
    expect(output).toContain('ℹ');
    expect(output).toContain('提示信息');
  });

  it('应格式化状态显示', () => {
    const formatter = new OutputFormatter('text');
    const statusOutput = formatter.formatStatus('running');
    expect(statusOutput).toContain('🟢');
    expect(statusOutput).toContain('running');

    const stoppedOutput = formatter.formatStatus('stopped');
    expect(stoppedOutput).toContain('🔴');

    const unknownOutput = formatter.formatStatus('custom_status');
    expect(unknownOutput).toContain('custom_status');
  });
});

// ═══════════════════════════════════════
// WebSocket 客户端基础测试
// ═══════════════════════════════════════

describe('WebSocket 事件常量', () => {
  it('应定义所有事件类型', async () => {
    const { WebSocketEvent } = await import('../api/websocket.js');

    expect(WebSocketEvent.CONNECTED).toBe('connected');
    expect(WebSocketEvent.DISCONNECTED).toBe('disconnected');
    expect(WebSocketEvent.ERROR).toBe('error');
    expect(WebSocketEvent.MESSAGE).toBe('message');
    expect(WebSocketEvent.RESPONSE).toBe('response');
    expect(WebSocketEvent.EVENT).toBe('event');
    expect(WebSocketEvent.CHAT_DELTA).toBe('chat.delta');
    expect(WebSocketEvent.CHAT_REASONING_DELTA).toBe('chat.reasoning_delta');
    expect(WebSocketEvent.CHAT_DONE).toBe('chat.done');
  });
});

// ═══════════════════════════════════════
// API 类型测试
// ═══════════════════════════════════════

describe('API 类型定义', () => {
  it('应导出所有必要的类型', async () => {
    const types = await import('../api/types.js');

    // 验证类型模块导出
    expect(types.MessageType.REQUEST).toBe('request');
    expect(types.MessageType.RESPONSE).toBe('response');
    expect(types.MessageType.EVENT).toBe('event');
    expect(types.MessageType.PING).toBe('ping');
    expect(types.MessageType.PONG).toBe('pong');
  });

  it('应支持 GatewayMessage 联合类型', async () => {
    // 验证类型系统接受各种消息类型
    const requestMsg = {
      type: 'request' as const,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      action: 'test.action',
      payload: {},
    };

    const responseMsg = {
      type: 'response' as const,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      requestId: randomUUID(),
      status: 'success' as const,
      payload: {},
    };

    const eventMsg = {
      type: 'event' as const,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      event: 'chat.delta',
      payload: {},
    };

    expect(requestMsg.type).toBe('request');
    expect(responseMsg.type).toBe('response');
    expect(eventMsg.type).toBe('event');
  });
});

// ═══════════════════════════════════════
// 配置文件加载测试
// ═══════════════════════════════════════

describe('配置文件加载', () => {
  it('应从环境变量加载配置覆盖', async () => {
    // 设置环境变量（使用正确的环境变量名 OPENCLAW_GATEWAY）
    const originalUrl = process.env.OPENCLAW_GATEWAY;
    process.env.OPENCLAW_GATEWAY = 'https://env-config.example.com';

    try {
      // 清除配置缓存以确保重新加载
      const { clearConfigCache } = await import('../config/loader.js');
      clearConfigCache();

      const { loadConfig } = await import('../config/loader.js');
      const config = await loadConfig({ useCache: false });

      // 环境变量应覆盖默认值
      expect(config.gateway.url).toBe('https://env-config.example.com');
    } finally {
      // 恢复环境变量
      if (originalUrl !== undefined) {
        process.env.OPENCLAW_GATEWAY = originalUrl;
      } else {
        delete process.env.OPENCLAW_GATEWAY;
      }
    }
  });
});
