/**
 * Core Schemas 单元测试
 */
import { describe, it, expect } from 'vitest';
import { MessageSchema } from '../../../src/core/schemas/message.schema.js';
import { SessionConfigSchema } from '../../../src/core/schemas/session.schema.js';
import {
  ToolNameSchema,
  ModelAwareConfigSchema,
} from '../../../src/core/schemas/extensions.js';
import { validate as validateSchema, isvalid, safeValidate } from '../../../src/core/schemas/validator.js';

describe('Core - Schemas', () => {
  describe('MessageSchema (TypeBox)', () => {
    const validMessage = {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      channelId: 'webchat',
      userId: 'user-001',
      sessionId: 'session-001',
      agentId: 'agent-default',
      type: 'text',
      role: 'user',
      content: '你好，世界',
      attachments: [],
      timestamp: 1700000000000,
      metadata: {},
    };

    it('应通过合法消息的校验', () => {
      const result = validateSchema(MessageSchema, validMessage);
      expect(result).toBeDefined();
      expect(result.id).toBe(validMessage.id);
    });

    it('isvalid 应对合法消息返回 true', () => {
      expect(isvalid(MessageSchema, validMessage)).toBe(true);
    });

    it('safeValidate 应对合法消息返回 success', () => {
      const result = safeValidate(MessageSchema, validMessage);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(validMessage.id);
      }
    });

    it('应拒绝空 channelId', () => {
      const badMsg = { ...validMessage, channelId: '' };
      expect(isvalid(MessageSchema, badMsg)).toBe(false);
    });

    it('应拒绝空 userId', () => {
      const badMsg = { ...validMessage, userId: '' };
      expect(isvalid(MessageSchema, badMsg)).toBe(false);
    });

    it('应拒绝无效的消息类型', () => {
      const badMsg = { ...validMessage, type: 'invalid_type' };
      expect(isvalid(MessageSchema, badMsg)).toBe(false);
    });

    it('应拒绝无效的 role', () => {
      const badMsg = { ...validMessage, role: 'admin' };
      expect(isvalid(MessageSchema, badMsg)).toBe(false);
    });

    it('应支持 tool_call 消息类型', () => {
      const toolMsg = {
        ...validMessage,
        type: 'tool_call',
        role: 'agent',
        content: '',
        toolCall: { toolName: 'search', arguments: { q: 'test' }, callId: 'c1' },
      };
      expect(isvalid(MessageSchema, toolMsg)).toBe(true);
    });

    it('应拒绝 ulid 格式不正确的 id', () => {
      const badMsg = { ...validMessage, id: 'not-a-valid-ulid' };
      expect(isvalid(MessageSchema, badMsg)).toBe(false);
    });

    it('应拒绝负数的 timestamp', () => {
      const badMsg = { ...validMessage, timestamp: -1 };
      expect(isvalid(MessageSchema, badMsg)).toBe(false);
    });

    it('应接受带附件列表的消息', () => {
      const msgWithAtt = {
        ...validMessage,
        attachments: [
          {
            id: 'att-1',
            type: 'file',
            mimeType: 'text/csv',
            filename: 'data.csv',
            size: 1024,
          },
        ],
      };
      expect(isvalid(MessageSchema, msgWithAtt)).toBe(true);
    });

    it('应拒绝 priority 超出 0-9 范围', () => {
      const badMsg = { ...validMessage, priority: 10 };
      expect(isvalid(MessageSchema, badMsg)).toBe(false);
    });

    it('validate 应在校验失败时抛出错误', () => {
      expect(() => validateSchema(MessageSchema, {})).toThrow();
    });
  });

  describe('SessionConfigSchema (Zod)', () => {
    it('应通过合法配置的校验', () => {
      const config = { agentId: 'default-agent' };
      const result = SessionConfigSchema.parse(config);
      expect(result.agentId).toBe('default-agent');
      expect(result.memoryWindowSize).toBe(20); // 默认值
      expect(result.temperature).toBe(0.7); // 默认值
    });

    it('应拒绝空 agentId', () => {
      expect(() => SessionConfigSchema.parse({ agentId: '' })).toThrow();
    });

    it('应拒绝超长 systemPrompt', () => {
      expect(() =>
        SessionConfigSchema.parse({
          agentId: 'test',
          systemPrompt: 'x'.repeat(8193),
        }),
      ).toThrow();
    });

    it('.strict() 应拒绝未知字段', () => {
      expect(() =>
        SessionConfigSchema.parse({
          agentId: 'test',
          unknownField: 'should reject',
        }),
      ).toThrow();
    });
  });

  describe('自定义校验扩展', () => {
    it('ToolNameSchema 应通过合法 snake_case', () => {
      expect(ToolNameSchema.parse('file_reader')).toBe('file_reader');
      expect(ToolNameSchema.parse('search')).toBe('search');
    });

    it('ToolNameSchema 应拒绝连续下划线', () => {
      expect(() => ToolNameSchema.parse('file__reader')).toThrow();
    });

    it('ToolNameSchema 应拒绝大写字母', () => {
      expect(() => ToolNameSchema.parse('FileReader')).toThrow();
    });

    it('ModelAwareConfigSchema 应拒绝超过模型上限的 maxTokens', () => {
      expect(() =>
        ModelAwareConfigSchema.parse({
          agentId: 'test',
          model: 'gpt-4o',
          maxTokens: 99999,
        }),
      ).toThrow();
    });
  });
});
