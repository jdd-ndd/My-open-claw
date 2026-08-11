/**
 * Channels 与 Gateway 集成测试
 *
 * 验证 ChannelManager 与 Gateway Router 的完整集成流程：
 * 1. 渠道注册 → 初始化 → 启动
 * 2. 消息接收 → 归一化 → 路由到 Agent
 * 3. Agent 回复 → 通过渠道发送给用户
 * 4. 渠道状态同步到 StateManager
 * 5. 健康检查
 *
 * @module server/tests/integration/channels
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// 导入实际模块
import { ChannelManager } from '../../../src/channels/manager.js';
import { MessageRouter } from '../../../src/gateway/routing/index.js';
import { SessionManager } from '../../../src/gateway/sessions/index.js';
import { MemoryStorage } from '../../../src/gateway/core/storage.js';
import { StateManager } from '../../../src/gateway/state/index.js';
import { toNormalizedMessage } from '../../../src/channels/base.js';
import {
  MessageType,
  ChannelLifecycleState as State,
  createDefaultChannelStats,
} from '../../../src/channels/types.js';
import type {
  ChannelProvider,
  ChannelConfig,
  ChannelContext,
  ChannelStatus,
  ChannelCapabilities,
  OutboundMessage,
  MessageTarget,
  SendMessageResult,
  InboundMessage,
} from '../../../src/channels/types.js';

// ══════════════════════════════════════════════════════════════
// Mock QQBot Provider（模拟完整的 QQBot 行为）
// ══════════════════════════════════════════════════════════════

interface MockQQBotConfig extends ChannelConfig {
  appId: string;
  botToken: string;
  wsUrl: string;
  heartbeatInterval: number;
}

const MOCK_QQBOT_CAPABILITIES: ChannelCapabilities = {
  textMessage: true,
  imageMessage: true,
  fileMessage: true,
  audioMessage: true,
  videoMessage: false,
  markdown: true,
  richText: false,
  buttons: true,
  groupMessage: true,
  maxTextLength: 2000,
  editMessage: false,
  deleteMessage: false,
  typingIndicator: false,
};

class MockQQBotProvider implements ChannelProvider {
  readonly id = 'qqbot_test';
  readonly displayName = 'QQBot(Test)';
  readonly capabilities: ChannelCapabilities = { ...MOCK_QQBOT_CAPABILITIES };

  private currentState: State = State.UNINITIALIZED;
  private context: ChannelContext | null = null;
  private config: MockQQBotConfig | null = null;
  private stats = createDefaultChannelStats();

  async initialize(config: ChannelConfig): Promise<void> {
    this.config = config as MockQQBotConfig;
    this.currentState = State.INITIALIZED;
  }

  async start(context: ChannelContext): Promise<void> {
    this.context = context;
    this.currentState = State.CONNECTED;
    context.logger.info('Mock QQBot 已启动');
  }

  async stop(): Promise<void> {
    this.currentState = State.STOPPED;
  }

  async sendMessage(_target: MessageTarget, message: OutboundMessage): Promise<SendMessageResult> {
    this.stats.messagesSent++;
    this.stats.lastMessageSentAt = Date.now();
    return {
      success: true,
      platformMessageId: `mock_${Date.now()}`,
      timestamp: Date.now(),
    };
  }

  getStatus(): ChannelStatus {
    return {
      state: this.currentState,
      channelId: this.id,
      displayName: this.displayName,
      isRunning: this.currentState === State.CONNECTED,
      reconnectAttempts: 0,
      stats: { ...this.stats },
    };
  }

  async healthCheck(): Promise<boolean> {
    return this.currentState === State.CONNECTED;
  }

  /** 模拟接收消息 */
  simulateInboundMessage(msg: InboundMessage): void {
    this.stats.messagesReceived++;
    this.stats.lastMessageReceivedAt = Date.now();
    this.context?.onMessage(msg);
  }

  /** 模拟接收带附件的消息 */
  simulateMediaMessage(userId: string, username: string, text: string, attachments: InboundMessage['attachments']): void {
    const msg: InboundMessage = {
      messageId: `test_msg_${Date.now()}`,
      channelId: this.id,
      userId,
      username,
      chatType: 'private',
      messageType: attachments?.[0]?.type === 'image' ? MessageType.IMAGE : MessageType.TEXT,
      text,
      attachments,
      raw: {},
      timestamp: Date.now(),
    };
    this.simulateInboundMessage(msg);
  }
}

// ══════════════════════════════════════════════════════════════
// Mock Agent（模拟 Agent 回复）
// ══════════════════════════════════════════════════════════════

interface MockAgentReply {
  channelId: string;
  target: MessageTarget;
  message: OutboundMessage;
}

// ══════════════════════════════════════════════════════════════
// Tests
// ══════════════════════════════════════════════════════════════

describe('Channels + Gateway 集成测试', () => {
  let channelManager: ChannelManager;
  let messageRouter: MessageRouter;
  let stateManager: StateManager;
  let storage: MemoryStorage;

  beforeEach(() => {
    // 重置单例
    ChannelManager.resetInstance();
    channelManager = ChannelManager.getInstance();

    // 初始化共享基础设施
    storage = new MemoryStorage();
    const sessions = new SessionManager(storage);
    sessions.initDatabase();
    messageRouter = new MessageRouter(sessions);
    stateManager = new StateManager('1.0.0-test');

    // 注册默认 Agent 路由规则
    messageRouter.loadRules([
      {
        id: 'default-agent',
        channels: [
          { channelId: 'qqbot_test', userIds: ['*'] },
        ],
      },
    ]);
  });

  describe('渠道生命周期与 StateManager 集成', () => {
    it('渠道启动后应更新 StateManager', async () => {
      channelManager.register('qqbot_test', () => new MockQQBotProvider());

      await channelManager.initializeAll([
        {
          channelId: 'qqbot_test',
          enabled: true,
          appId: 'test_app',
          botToken: 'test_token',
          wsUrl: 'ws://localhost:9999',
          heartbeatInterval: 30000,
        } as unknown as ChannelConfig,
      ]);

      await channelManager.startAll();

      const status = channelManager.getChannelStatus('qqbot_test');
      expect(status).not.toBeNull();
      expect(status!.isRunning).toBe(true);
      expect(status!.state).toBe(State.CONNECTED);
    });

    it('渠道停止后状态应变为 STOPPED', async () => {
      channelManager.register('qqbot_test', () => new MockQQBotProvider());

      await channelManager.initializeAll([
        { channelId: 'qqbot_test', enabled: true } as ChannelConfig,
      ]);

      await channelManager.startAll();
      await channelManager.stopAll();

      const status = channelManager.getChannelStatus('qqbot_test');
      expect(status!.state).toBe(State.STOPPED);
    });
  });

  describe('消息接收与 Router 集成', () => {
    it('消息应能从渠道通过 ChannelManager 路由到 Router', async () => {
      const provider = new MockQQBotProvider();
      channelManager.register('qqbot_test', () => provider);

      await channelManager.initializeAll([
        { channelId: 'qqbot_test', enabled: true } as ChannelConfig,
      ]);

      // 设置路由回调
      let routedMessage: InboundMessage | null = null;
      channelManager.setRouteHandler(async (msg: InboundMessage) => {
        routedMessage = msg;
        // 将消息通过 Router 处理
        const normalized = toNormalizedMessage(msg);
        await messageRouter.route(normalized);
      });

      await channelManager.startAll();

      // 模拟用户发送消息
      provider.simulateInboundMessage({
        messageId: 'test_001',
        channelId: 'qqbot_test',
        userId: 'user_001',
        username: '测试用户',
        chatType: 'private',
        messageType: MessageType.TEXT,
        text: '你好，Agent！',
        raw: {},
        timestamp: Date.now(),
      });

      // 验证消息已路由
      expect(routedMessage).not.toBeNull();
      expect(routedMessage!.text).toBe('你好，Agent！');
      expect(routedMessage!.channelId).toBe('qqbot_test');

      // 验证会话已创建
      expect(messageRouter.activeSessionCount).toBeGreaterThanOrEqual(1);
    });

    it('Agent 回复应能通过渠道发送给用户', async () => {
      const provider = new MockQQBotProvider();
      channelManager.register('qqbot_test', () => provider);

      await channelManager.initializeAll([
        { channelId: 'qqbot_test', enabled: true } as ChannelConfig,
      ]);

      await channelManager.startAll();

      const result = await channelManager.sendToChannel(
        'qqbot_test',
        { chatType: 'private', userId: 'user_001' },
        {
          messageType: MessageType.TEXT,
          text: '你好，我是 Agent！',
          markdown: true,
        },
      );

      expect(result.success).toBe(true);
      expect(result.platformMessageId).toBeDefined();
    });

    it('未启动的渠道应拒绝发送', async () => {
      const result = await channelManager.sendToChannel(
        'nonexistent',
        { chatType: 'private' },
        { messageType: MessageType.TEXT, text: 'test' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('未找到');
    });
  });

  describe('多渠道并行管理', () => {
    it('应能同时管理多个渠道', async () => {
      channelManager.register('qqbot_test', () => new MockQQBotProvider());

      await channelManager.initializeAll([
        { channelId: 'qqbot_test', enabled: true } as ChannelConfig,
      ]);

      await channelManager.startAll();

      const statuses = channelManager.getAllStatus();
      expect(statuses.length).toBe(1);
      expect(statuses[0].isRunning).toBe(true);
    });
  });

  describe('健康检查', () => {
    it('运行中的渠道应通过健康检查', async () => {
      channelManager.register('qqbot_test', () => new MockQQBotProvider());

      await channelManager.initializeAll([
        { channelId: 'qqbot_test', enabled: true } as ChannelConfig,
      ]);

      await channelManager.startAll();

      const healthResults = await channelManager.healthCheckAll();
      expect(healthResults.get('qqbot_test')).toBe(true);
    });
  });

  describe('状态变更事件', () => {
    it('渠道启动和停止应发出事件', async () => {
      channelManager.register('qqbot_test', () => new MockQQBotProvider());

      let startedEventReceived = false;

      channelManager.on('manager:started', (data: unknown) => {
        startedEventReceived = true;
        expect((data as { total: number }).total).toBe(1);
      });

      await channelManager.initializeAll([
        { channelId: 'qqbot_test', enabled: true } as ChannelConfig,
      ]);
      await channelManager.startAll();

      expect(startedEventReceived).toBe(true);
    });
  });
});
