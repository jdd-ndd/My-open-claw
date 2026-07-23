/**
 * Core Types 单元测试
 */
import { describe, it, expect } from 'vitest';

describe('Core Types', () => {
  describe('Message', () => {
    it('应正确构造一条用户消息', () => {
      const msg = {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        channelId: 'webchat',
        userId: 'user-001',
        sessionId: 'session-001',
        type: 'text' as const,
        role: 'user' as const,
        content: '你好',
        attachments: [],
        timestamp: Date.now(),
        metadata: {},
        priority: 5,
      };
      expect(msg.type).toBe('text');
      expect(msg.role).toBe('user');
      expect(msg.priority).toBe(5);
    });

    it('应支持 tool_call 和 tool_result 消息类型', () => {
      const toolCallMsg = {
        id: 'TEST01',
        channelId: 'ws',
        userId: 'u1',
        sessionId: 's1',
        type: 'tool_call' as const,
        role: 'agent' as const,
        content: '',
        attachments: [],
        timestamp: 0,
        metadata: {},
        toolCall: { toolName: 'search', arguments: { q: 'test' }, callId: 'c1' },
      };
      expect(toolCallMsg.toolCall?.toolName).toBe('search');

      const toolResultMsg = {
        id: 'TEST02',
        channelId: 'ws',
        userId: 'u1',
        sessionId: 's1',
        type: 'tool_result' as const,
        role: 'tool' as const,
        content: '',
        attachments: [],
        timestamp: 0,
        metadata: {},
        toolResult: { callId: 'c1', result: 'ok', success: true, durationMs: 150 },
      };
      expect(toolResultMsg.toolResult?.success).toBe(true);
      expect(toolResultMsg.toolResult?.durationMs).toBe(150);
    });

    it('应支持附件结构', () => {
      const attachment = {
        id: 'att-1',
        type: 'file' as const,
        mimeType: 'text/csv',
        filename: 'data.csv',
        size: 1024,
        url: 'file:///data/data.csv',
      };
      expect(attachment.size).toBe(1024);
      expect(attachment.filename).toBe('data.csv');
    });

    it('应支持 parentMessageId 和 referencedMessageIds', () => {
      const msg = {
        id: 'm3',
        channelId: 'wc',
        userId: 'u1',
        sessionId: 's1',
        type: 'text' as const,
        role: 'user' as const,
        content: '继续',
        attachments: [],
        timestamp: 0,
        metadata: {},
        parentMessageId: 'm1',
        referencedMessageIds: ['m1', 'm2'],
      };
      expect(msg.parentMessageId).toBe('m1');
      expect(msg.referencedMessageIds).toHaveLength(2);
    });
  });

  describe('Session', () => {
    it('应正确初始化会话状态', () => {
      const session = {
        id: 's1',
        userId: 'u1',
        channelId: 'wc',
        status: 'active' as const,
        config: { agentId: 'default', model: 'gpt-4o', temperature: 0.7 },
        stats: { messageCount: 0, toolCallCount: 0, totalTokens: 0, totalLatencyMs: 0 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      };
      expect(session.status).toBe('active');
      expect(session.config.model).toBe('gpt-4o');
      expect(session.stats.messageCount).toBe(0);
    });
  });

  describe('Task', () => {
    it('应正确初始化任务', () => {
      const task = {
        id: 't1',
        sessionId: 's1',
        triggerMessageId: 'm1',
        goal: '分析销售数据',
        status: 'pending' as const,
        steps: [],
        createdAt: Date.now(),
        metadata: {},
      };
      expect(task.status).toBe('pending');
      expect(task.goal).toBe('分析销售数据');
    });

    it('应支持任务步骤记录', () => {
      const step = {
        id: 'step-1',
        index: 1,
        kind: 'action' as const,
        content: '调用 read_file 工具',
        toolCallId: 'tc1',
        startedAt: Date.now(),
      };
      expect(step.kind).toBe('action');
      expect(step.index).toBe(1);
    });
  });
});
