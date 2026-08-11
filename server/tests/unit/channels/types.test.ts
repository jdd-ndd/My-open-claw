/**
 * 渠道模块核心类型单元测试
 *
 * @module server/tests/unit/channels
 */

import { describe, it, expect } from 'vitest';
import {
  MessageType,
  ChannelLifecycleState,
  DEFAULT_RECONNECT_CONFIG,
  createDefaultChannelStats,
} from '../../../src/channels/types.js';

describe('MessageType', () => {
  it('应该定义所有消息类型', () => {
    expect(MessageType.TEXT).toBe('text');
    expect(MessageType.IMAGE).toBe('image');
    expect(MessageType.FILE).toBe('file');
    expect(MessageType.AUDIO).toBe('audio');
    expect(MessageType.VIDEO).toBe('video');
    expect(MessageType.STICKER).toBe('sticker');
    expect(MessageType.LOCATION).toBe('location');
    expect(MessageType.CONTACT).toBe('contact');
  });
});

describe('ChannelLifecycleState', () => {
  it('应该定义所有生命周期状态', () => {
    expect(ChannelLifecycleState.UNINITIALIZED).toBe('uninitialized');
    expect(ChannelLifecycleState.INITIALIZED).toBe('initialized');
    expect(ChannelLifecycleState.CONNECTING).toBe('connecting');
    expect(ChannelLifecycleState.CONNECTED).toBe('connected');
    expect(ChannelLifecycleState.DISCONNECTING).toBe('disconnecting');
    expect(ChannelLifecycleState.DISCONNECTED).toBe('disconnected');
    expect(ChannelLifecycleState.RECONNECTING).toBe('reconnecting');
    expect(ChannelLifecycleState.ERROR).toBe('error');
    expect(ChannelLifecycleState.STOPPED).toBe('stopped');
  });
});

describe('DEFAULT_RECONNECT_CONFIG', () => {
  it('应该具有合理的默认值', () => {
    expect(DEFAULT_RECONNECT_CONFIG.enabled).toBe(true);
    expect(DEFAULT_RECONNECT_CONFIG.maxAttempts).toBe(10);
    expect(DEFAULT_RECONNECT_CONFIG.initialInterval).toBe(1000);
    expect(DEFAULT_RECONNECT_CONFIG.maxInterval).toBe(30000);
    expect(DEFAULT_RECONNECT_CONFIG.backoffFactor).toBe(2);
  });
});

describe('createDefaultChannelStats', () => {
  it('应该创建初始化为零的统计对象', () => {
    const stats = createDefaultChannelStats();
    expect(stats.messagesReceived).toBe(0);
    expect(stats.messagesSent).toBe(0);
    expect(stats.receiveErrors).toBe(0);
    expect(stats.sendErrors).toBe(0);
  });

  it('每次调用应该返回新的独立对象', () => {
    const stats1 = createDefaultChannelStats();
    const stats2 = createDefaultChannelStats();
    stats1.messagesReceived = 10;
    expect(stats2.messagesReceived).toBe(0);
  });
});
