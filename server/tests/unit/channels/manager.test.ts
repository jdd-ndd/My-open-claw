/**
 * ChannelManager 单元测试
 *
 * @module server/tests/unit/channels
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelManager } from '../../../src/channels/manager.js';
import { ChannelLifecycleState as State } from '../../../src/channels/types.js';
import type { ChannelProvider, LegacyChannelProvider } from '../../../src/channels/base.js';
import type {
  ChannelConfig,
  ChannelStatus,
  ChannelCapabilities,
  OutboundMessage,
  MessageTarget,
  SendMessageResult,
  InboundMessage,
  ChannelContext,
} from '../../../src/channels/types.js';
import { createDefaultChannelStats } from '../../../src/channels/types.js';

// ══════════════════════════════════════════════════════════════
// Mock Provider
// ══════════════════════════════════════════════════════════════

function createMockProvider(
  id: string,
  displayName: string,
  capabilities?: Partial<ChannelCapabilities>,
): ChannelProvider {
  let state = State.UNINITIALIZED;
  let ctx: ChannelContext | null = null;
  const stats = createDefaultChannelStats();
  let onMsg: ((message: InboundMessage) => void) | null = null;

  return {
    id,
    displayName,
    capabilities: {
      textMessage: true,
      imageMessage: true,
      fileMessage: false,
      audioMessage: false,
      videoMessage: false,
      markdown: true,
      richText: false,
      buttons: false,
      groupMessage: true,
      maxTextLength: 2000,
      editMessage: false,
      deleteMessage: false,
      typingIndicator: false,
      ...capabilities,
    },

    async initialize(_config: ChannelConfig): Promise<void> {
      state = State.INITIALIZED;
    },

    async start(context: ChannelContext): Promise<void> {
      state = State.CONNECTED;
      ctx = context;
    },

    async stop(): Promise<void> {
      state = State.STOPPED;
    },

    async sendMessage(_target: MessageTarget, _message: OutboundMessage): Promise<SendMessageResult> {
      stats.messagesSent++;
      return { success: true, timestamp: Date.now() };
    },

    getStatus(): ChannelStatus {
      return {
        state,
        channelId: id,
        displayName,
        isRunning: state === State.CONNECTED,
        reconnectAttempts: 0,
        stats: { ...stats },
      };
    },

    setOnMessage(callback: (message: InboundMessage) => void): void {
      onMsg = callback;
    },
  };
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

describe('ChannelManager', () => {
  let manager: ChannelManager;

  beforeEach(() => {
    ChannelManager.resetInstance();
    manager = ChannelManager.getInstance();
  });

  describe('单例管理', () => {
    it('应该返回同一个实例', () => {
      const m1 = ChannelManager.getInstance();
      const m2 = ChannelManager.getInstance();
      expect(m1).toBe(m2);
    });

    it('resetInstance 后应创建新实例', () => {
      const m1 = ChannelManager.getInstance();
      ChannelManager.resetInstance();
      const m2 = ChannelManager.getInstance();
      expect(m1).not.toBe(m2);
    });
  });

  describe('注册', () => {
    it('应该正确注册渠道 Provider', () => {
      manager.register('qqbot', () => createMockProvider('qqbot', 'QQBot'));
      expect(manager.isRegistered('qqbot')).toBe(true);
      expect(manager.getRegisteredChannelIds()).toContain('qqbot');
    });

    it('重复注册应给出警告但不报错', () => {
      manager.register('test', () => createMockProvider('test', 'Test'));
      manager.register('test', () => createMockProvider('test', 'Test2'));
      expect(manager.isRegistered('test')).toBe(true);
    });
  });

  describe('初始化', () => {
    it('应该初始化已注册且启用的渠道', async () => {
      manager.register('qqbot', () => createMockProvider('qqbot', 'QQBot'));
      manager.register('feishu', () => createMockProvider('feishu', 'Feishu'));

      await manager.initializeAll([
        { channelId: 'qqbot', enabled: true },
        { channelId: 'feishu', enabled: false },
      ]);

      expect(manager.getAllChannelIds()).toContain('qqbot');
      expect(manager.getAllChannelIds()).not.toContain('feishu');
    });

    it('应该跳过未注册的渠道', async () => {
      await manager.initializeAll([
        { channelId: 'nonexistent', enabled: true },
      ]);

      expect(manager.getAllChannelIds()).toHaveLength(0);
    });
  });

  describe('启动/停止', () => {
    it('应该启动所有已初始化的渠道', async () => {
      manager.register('qqbot', () => createMockProvider('qqbot', 'QQBot'));
      await manager.initializeAll([{ channelId: 'qqbot', enabled: true }]);
      await manager.startAll();

      expect(manager.isStarted()).toBe(true);
      const status = manager.getChannelStatus('qqbot');
      expect(status?.isRunning).toBe(true);
    });

    it('应该停止所有渠道', async () => {
      manager.register('qqbot', () => createMockProvider('qqbot', 'QQBot'));
      await manager.initializeAll([{ channelId: 'qqbot', enabled: true }]);
      await manager.startAll();
      await manager.stopAll();

      expect(manager.isStarted()).toBe(false);
      const status = manager.getChannelStatus('qqbot');
      expect(status?.state).toBe(State.STOPPED);
    });
  });

  describe('消息发送', () => {
    it('应该向目标渠道发送消息', async () => {
      manager.register('qqbot', () => createMockProvider('qqbot', 'QQBot'));
      await manager.initializeAll([{ channelId: 'qqbot', enabled: true }]);
      await manager.startAll();

      const result = await manager.sendToChannel('qqbot', { chatType: 'private', userId: 'user1' }, {
        messageType: { textMessage: true } as unknown as import('../../../src/channels/types.js').MessageType,
        text: 'Hello',
      });

      expect(result.success).toBe(true);
    });

    it('向未运行的渠道发送消息应返回失败', async () => {
      const result = await manager.sendToChannel('nonexistent', { chatType: 'private' }, {
        messageType: { textMessage: true } as unknown as import('../../../src/channels/types.js').MessageType,
        text: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('状态查询', () => {
    it('应该返回所有渠道状态', async () => {
      manager.register('qqbot', () => createMockProvider('qqbot', 'QQBot'));
      manager.register('feishu', () => createMockProvider('feishu', 'Feishu'));
      await manager.initializeAll([
        { channelId: 'qqbot', enabled: true },
        { channelId: 'feishu', enabled: true },
      ]);
      await manager.startAll();

      const allStatus = manager.getAllStatus();
      expect(allStatus).toHaveLength(2);
      allStatus.forEach((s) => expect(s.isRunning).toBe(true));
    });

    it('getRunningChannels 应只返回运行中的渠道', async () => {
      manager.register('qqbot', () => createMockProvider('qqbot', 'QQBot'));
      manager.register('feishu', () => createMockProvider('feishu', 'Feishu'));
      await manager.initializeAll([
        { channelId: 'qqbot', enabled: true },
        { channelId: 'feishu', enabled: true },
      ]);
      await manager.startAll();

      const running = manager.getRunningChannels();
      expect(running).toHaveLength(2);
    });
  });
});
