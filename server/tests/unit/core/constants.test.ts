/**
 * Core Constants 单元测试
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GATEWAY_PORT,
  DEFAULT_HTTP_PORT,
  AGENT_PORT_RANGE,
  LLM_TIMEOUT_MS,
  TOOL_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  EventType,
  PROTOCOL_VERSION,
  FRAMEWORK_NAME,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../../src/core/constants/index.js';

describe('Core - Constants', () => {
  describe('系统常量', () => {
    it('PROTOCOL_VERSION 应为 1.0.0', () => {
      expect(PROTOCOL_VERSION).toBe('1.0.0');
    });

    it('FRAMEWORK_NAME 应为 MyOpenClaw', () => {
      expect(FRAMEWORK_NAME).toBe('MyOpenClaw');
    });

    it('DEFAULT_PAGE_SIZE 应为 20', () => {
      expect(DEFAULT_PAGE_SIZE).toBe(20);
    });

    it('MAX_PAGE_SIZE 应为 100', () => {
      expect(MAX_PAGE_SIZE).toBe(100);
    });
  });

  describe('端口常量', () => {
    it('默认 Gateway 端口应为 18780，HTTP 端口应为 18790', () => {
      expect(DEFAULT_GATEWAY_PORT).toBe(18780);
      expect(DEFAULT_HTTP_PORT).toBe(18790);
    });

    it('Agent 端口范围应正确', () => {
      expect(AGENT_PORT_RANGE.min).toBe(19000);
      expect(AGENT_PORT_RANGE.max).toBe(19999);
    });
  });

  describe('超时常量', () => {
    it('LLM 超时 60s', () => expect(LLM_TIMEOUT_MS).toBe(60000));
    it('Tool 超时 30s', () => expect(TOOL_TIMEOUT_MS).toBe(30000));
    it('会话空闲超时 30min', () => expect(SESSION_IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000));
    it('心跳间隔 30s', () => expect(HEARTBEAT_INTERVAL_MS).toBe(30000));
    it('心跳超时 90s', () => expect(HEARTBEAT_TIMEOUT_MS).toBe(90000));
  });

  describe('事件名常量', () => {
    it('应定义所有核心事件名', () => {
      expect(EventType.MESSAGE_RECEIVED).toBe('messageReceived');
      expect(EventType.AGENT_THINKING).toBe('agentThinking');
      expect(EventType.TOOL_EXECUTING).toBe('toolExecuting');
      expect(EventType.TASK_COMPLETED).toBe('taskCompleted');
      expect(EventType.SESSION_CREATED).toBe('sessionCreated');
      expect(EventType.SESSION_CLOSED).toBe('sessionClosed');
      expect(EventType.ERROR).toBe('error');
    });
  });
});
