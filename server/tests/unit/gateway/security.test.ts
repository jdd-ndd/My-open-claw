/**
 * SecuritySandbox 安全沙箱模块单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SecuritySandbox } from '../../../src/gateway/security/index.js';
import type { SecurityConfig } from '../../../src/gateway/security/types.js';

function makeConfig(overrides?: Partial<SecurityConfig>): SecurityConfig {
  return {
    apiToken: 'test-token',
    rateLimit: 60,
    sandboxEnabled: true,
    allowedCommands: ['ls', 'cat', 'grep', 'find', 'echo'],
    dangerPatterns: SecuritySandbox.DEFAULT_DANGER_PATTERNS,
    ...overrides,
  };
}

describe('Gateway - SecuritySandbox', () => {
  let sandbox: SecuritySandbox;

  describe('authenticate', () => {
    it('Token 匹配时应返回 passed:true', () => {
      sandbox = new SecuritySandbox(makeConfig());
      const result = sandbox.authenticate('test-token');
      expect(result.passed).toBe(true);
    });

    it('Token 不匹配时应返回 passed:false', () => {
      sandbox = new SecuritySandbox(makeConfig());
      const result = sandbox.authenticate('wrong-token');
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('auth_invalid');
    });

    it('apiToken 为空字符串时应跳过鉴权返回 passed:true', () => {
      sandbox = new SecuritySandbox(makeConfig({ apiToken: '' }));
      const result = sandbox.authenticate(undefined);
      expect(result.passed).toBe(true);
    });

    it('Token 为 undefined 且鉴权已启用时应返回 passed:false', () => {
      sandbox = new SecuritySandbox(makeConfig({ apiToken: 'required-token' }));
      const result = sandbox.authenticate(undefined);
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('auth_missing');
    });
  });

  describe('checkRateLimit', () => {
    beforeEach(() => {
      sandbox = new SecuritySandbox(makeConfig({ rateLimit: 60 }));
    });

    it('首次请求应允许通过', () => {
      const result = sandbox.checkRateLimit('client-1');
      expect(result.passed).toBe(true);
    });

    it('在限制范围内多次请求均应通过', () => {
      for (let i = 0; i < 50; i++) {
        const result = sandbox.checkRateLimit('client-1');
        expect(result.passed).toBe(true);
      }
    });

    it('令牌耗尽后应拒绝请求', () => {
      // 消耗所有 60 个令牌
      for (let i = 0; i < 60; i++) {
        sandbox.checkRateLimit('client-1');
      }
      const result = sandbox.checkRateLimit('client-1');
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('rate_limit_exceeded');
    });

    it('不同客户端应有独立的令牌桶', () => {
      // 消耗 client-1 所有令牌
      for (let i = 0; i < 60; i++) {
        sandbox.checkRateLimit('client-1');
      }
      // client-2 仍应通过
      const result = sandbox.checkRateLimit('client-2');
      expect(result.passed).toBe(true);
    });
  });

  describe('checkCommand', () => {
    beforeEach(() => {
      sandbox = new SecuritySandbox(makeConfig({
        sandboxEnabled: true,
        allowedCommands: ['ls', 'cat', 'grep', 'find', 'echo'],
      }));
    });

    it('应允许白名单中的命令', () => {
      const result = sandbox.checkCommand('ls -la');
      expect(result.passed).toBe(true);
    });

    it('应允许其他白名单命令', () => {
      expect(sandbox.checkCommand('cat file.txt').passed).toBe(true);
      expect(sandbox.checkCommand('echo hello').passed).toBe(true);
      expect(sandbox.checkCommand('find . -name test').passed).toBe(true);
      expect(sandbox.checkCommand('grep pattern file').passed).toBe(true);
    });

    it('应阻止不在白名单中的命令', () => {
      const result = sandbox.checkCommand('rm -rf /tmp/test');
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('cmd_not_allowed');
    });

    it('sandboxEnabled 为 false 时应直接放行任意命令', () => {
      sandbox = new SecuritySandbox(makeConfig({ sandboxEnabled: false }));
      const result = sandbox.checkCommand('rm -rf /');
      expect(result.passed).toBe(true);
    });
  });

  describe('checkDangerousContent', () => {
    beforeEach(() => {
      sandbox = new SecuritySandbox(makeConfig());
    });

    it('应阻止 rm -rf / 模式', () => {
      const result = sandbox.checkDangerousContent('rm -rf /');
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('rm_rf');
    });

    it('应阻止 DROP TABLE 模式', () => {
      const result = sandbox.checkDangerousContent('DROP TABLE users');
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('drop_table');
    });

    it('chmod 777 应返回 passed:true 但带警告', () => {
      const result = sandbox.checkDangerousContent('chmod 777 script.sh');
      expect(result.passed).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
    });

    it('普通安全内容应直接通过', () => {
      const result = sandbox.checkDangerousContent('ls -la');
      expect(result.passed).toBe(true);
      expect(result.warnings).toBeUndefined();
    });
  });

  describe('validateSchema', () => {
    beforeEach(() => {
      sandbox = new SecuritySandbox(makeConfig());
    });

    it('有效输入应通过校验', () => {
      const result = sandbox.validateSchema(
        { name: 'test', age: 25 },
        { type: 'object', required: ['name'], properties: {} },
      );
      expect(result.passed).toBe(true);
    });

    it('类型不匹配应校验失败', () => {
      const result = sandbox.validateSchema(
        'not-an-object',
        { type: 'object' },
      );
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('schema_type_mismatch');
    });

    it('缺少必填字段应校验失败', () => {
      const result = sandbox.validateSchema(
        { age: 25 },
        { type: 'object', required: ['name'] },
      );
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('schema_missing_required');
    });

    it('字段类型不匹配应校验失败', () => {
      const result = sandbox.validateSchema(
        { name: 'test', age: 'not-a-number' },
        {
          type: 'object',
          required: ['name'],
          properties: { age: { type: 'number' } },
        },
      );
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('schema_property_type_mismatch');
    });

    it('null 值应正确处理类型校验', () => {
      const result = sandbox.validateSchema(
        null,
        { type: 'object' },
      );
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('schema_type_mismatch');
    });

    it('数组类型应正确识别', () => {
      const result = sandbox.validateSchema(
        [1, 2, 3],
        { type: 'array' },
      );
      expect(result.passed).toBe(true);
    });

    it('无 schema 时应通过校验', () => {
      const result = sandbox.validateSchema({ anything: 'goes' }, {});
      expect(result.passed).toBe(true);
    });
  });
});
