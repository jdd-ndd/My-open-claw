/**
 * Gateway 协议类型单元测试
 *
 * 验证 RequestMessage / ResponseMessage / EventMessage / GatewayMessage 类型定义
 */
import { describe, it, expect } from 'vitest';
import type {
  RequestMessage,
  ResponseMessage,
  EventMessage,
  GatewayMessage,
} from '../../../src/gateway/protocol.js';

/** 工具函数：通过编译时类型检查辅助函数 */
function acceptGatewayMessage(_msg: GatewayMessage): boolean {
  return true;
}

describe('Gateway - 协议类型', () => {
  describe('RequestMessage', () => {
    it('应能构造包含所有字段的请求消息', () => {
      const msg: RequestMessage = {
        type: 'request',
        id: 'req-001',
        action: 'send_message',
        payload: { content: 'hello', targetId: 'channel-1' },
        timestamp: '2026-07-22T10:00:00.000Z',
      };

      expect(msg.type).toBe('request');
      expect(msg.id).toBe('req-001');
      expect(msg.action).toBe('send_message');
      expect(msg.payload).toEqual({ content: 'hello', targetId: 'channel-1' });
      expect(msg.timestamp).toBe('2026-07-22T10:00:00.000Z');
    });

    it('应接受空 payload 的请求消息', () => {
      const msg: RequestMessage = {
        type: 'request',
        id: 'req-002',
        action: 'ping',
        payload: {},
        timestamp: new Date().toISOString(),
      };

      expect(msg.payload).toEqual({});
      expect(msg.action).toBe('ping');
    });
  });

  describe('ResponseMessage', () => {
    it('应能构造成功状态的响应消息', () => {
      const msg: ResponseMessage = {
        type: 'response',
        id: 'resp-001',
        requestId: 'req-001',
        status: 'success',
        payload: { result: 'OK' },
        timestamp: '2026-07-22T10:00:01.000Z',
      };

      expect(msg.type).toBe('response');
      expect(msg.status).toBe('success');
      expect(msg.requestId).toBe('req-001');
      expect(msg.payload).toEqual({ result: 'OK' });
      expect(msg.errorCode).toBeUndefined();
      expect(msg.errorMessage).toBeUndefined();
    });

    it('应能构造包含 errorCode 和 errorMessage 的错误状态响应消息', () => {
      const msg: ResponseMessage = {
        type: 'response',
        id: 'resp-002',
        requestId: 'req-002',
        status: 'error',
        payload: {},
        timestamp: '2026-07-22T10:00:02.000Z',
        errorCode: 'AUTH_FAILED',
        errorMessage: 'Token 无效',
      };

      expect(msg.status).toBe('error');
      expect(msg.errorCode).toBe('AUTH_FAILED');
      expect(msg.errorMessage).toBe('Token 无效');
    });

    it('成功响应不应有 errorCode 和 errorMessage', () => {
      const msg: ResponseMessage = {
        type: 'response',
        id: 'resp-003',
        requestId: 'req-003',
        status: 'success',
        payload: { data: 42 },
        timestamp: new Date().toISOString(),
      };

      expect(msg.errorCode).toBeUndefined();
      expect(msg.errorMessage).toBeUndefined();
    });
  });

  describe('EventMessage', () => {
    it('应能构造事件消息', () => {
      const msg: EventMessage = {
        type: 'event',
        id: 'evt-001',
        event: 'channel.connected',
        payload: { channelId: 'discord', status: 'connected' },
        timestamp: '2026-07-22T10:00:00.000Z',
      };

      expect(msg.type).toBe('event');
      expect(msg.id).toBe('evt-001');
      expect(msg.event).toBe('channel.connected');
      expect(msg.payload).toEqual({ channelId: 'discord', status: 'connected' });
      expect(msg.timestamp).toBe('2026-07-22T10:00:00.000Z');
    });

    it('应接受 agent 状态变更事件', () => {
      const msg: EventMessage = {
        type: 'event',
        id: 'evt-002',
        event: 'agent.stateChanged',
        payload: { agentId: 'agent-1', status: 'busy' },
        timestamp: new Date().toISOString(),
      };

      expect(msg.event).toBe('agent.stateChanged');
      expect(msg.payload.agentId).toBe('agent-1');
    });
  });

  describe('GatewayMessage 联合类型', () => {
    it('应接受 RequestMessage 类型', () => {
      const msg: RequestMessage = {
        type: 'request',
        id: 'r1',
        action: 'test',
        payload: {},
        timestamp: new Date().toISOString(),
      };
      expect(acceptGatewayMessage(msg)).toBe(true);
    });

    it('应接受 ResponseMessage 类型', () => {
      const msg: ResponseMessage = {
        type: 'response',
        id: 'r2',
        requestId: 'r1',
        status: 'success',
        payload: {},
        timestamp: new Date().toISOString(),
      };
      expect(acceptGatewayMessage(msg)).toBe(true);
    });

    it('应接受 EventMessage 类型', () => {
      const msg: EventMessage = {
        type: 'event',
        id: 'r3',
        event: 'test.event',
        payload: {},
        timestamp: new Date().toISOString(),
      };
      expect(acceptGatewayMessage(msg)).toBe(true);
    });
  });
});
