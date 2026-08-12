/**
 * Channels 模块 — 边界条件与异常场景测试
 *
 * @module server/tests/unit/channels
 */

import { describe, it, expect } from 'vitest';
import {
  canTransition, transition, safeTransition,
  isRunningState, canBecomeRunning, isTerminalState, isErrorState,
} from '../../../src/channels/lifecycle.js';
import { ChannelLifecycleState as State } from '../../../src/channels/types.js';
import { toNormalizedMessage } from '../../../src/channels/base.js';
import type { InboundMessage } from '../../../src/channels/types.js';
import { MessageType } from '../../../src/channels/types.js';

// ══════════════════════════════════════════════════════════════
// 生命周期状态机 — 边界测试
// ══════════════════════════════════════════════════════════════

describe('生命周期状态机 — 边界与异常', () => {
  describe('状态转换完整性', () => {
    it('所有 9 个状态应覆盖完整的状态机', () => {
      const allStates = Object.values(State);
      expect(allStates).toHaveLength(9);
    });

    it('每个状态至少应有一个可转换目标', () => {
      const allStates = Object.values(State);
      for (const state of allStates) {
        const hasTransition = allStates.some((target) => canTransition(state, target));
        // STOPPED 是终态，没有出边
        if (state === State.STOPPED) {
          expect(hasTransition).toBe(false);
        } else {
          expect(hasTransition).toBe(true);
        }
      }
    });

    it('transition 异常应包含状态信息', () => {
      try {
        transition(State.STOPPED, State.CONNECTED);
        expect.unreachable('应该抛出异常');
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain('非法');
        expect(msg).toContain(State.STOPPED);
        expect(msg).toContain(State.CONNECTED);
      }
    });
  });

  describe('safeTransition 容错', () => {
    it('从 STOPPED 尝试任何转换都应返回 STOPPED', () => {
      expect(safeTransition(State.STOPPED, State.CONNECTED)).toBe(State.STOPPED);
      expect(safeTransition(State.STOPPED, State.INITIALIZED)).toBe(State.STOPPED);
      expect(safeTransition(State.STOPPED, State.RECONNECTING)).toBe(State.STOPPED);
    });

    it('从 CONNECTED 尝试跳回 UNINITIALIZED 应返回 CONNECTED', () => {
      expect(safeTransition(State.CONNECTED, State.UNINITIALIZED)).toBe(State.CONNECTED);
    });
  });

  describe('辅助函数的边界', () => {
    it('isRunningState 对所有状态判断正确', () => {
      const runningStates = [State.CONNECTED];
      const nonRunningStates = Object.values(State).filter((s) => s !== State.CONNECTED);
      for (const s of runningStates) expect(isRunningState(s)).toBe(true);
      for (const s of nonRunningStates) expect(isRunningState(s)).toBe(false);
    });

    it('isTerminalState 仅 STOPPED 为终态', () => {
      for (const s of Object.values(State)) {
        expect(isTerminalState(s)).toBe(s === State.STOPPED);
      }
    });

    it('isErrorState 仅 ERROR 为错误状态', () => {
      for (const s of Object.values(State)) {
        expect(isErrorState(s)).toBe(s === State.ERROR);
      }
    });

    it('canBecomeRunning 的正确性', () => {
      expect(canBecomeRunning(State.INITIALIZED)).toBe(true);
      expect(canBecomeRunning(State.DISCONNECTED)).toBe(true);
      expect(canBecomeRunning(State.ERROR)).toBe(true);
      expect(canBecomeRunning(State.CONNECTED)).toBe(false);
      expect(canBecomeRunning(State.STOPPED)).toBe(false);
      expect(canBecomeRunning(State.UNINITIALIZED)).toBe(false);
    });
  });
});

// ══════════════════════════════════════════════════════════════
// toNormalizedMessage — 边界测试
// ══════════════════════════════════════════════════════════════

describe('toNormalizedMessage — 边界测试', () => {
  it('空消息文本应正常转换', () => {
    const msg: InboundMessage = {
      messageId: 'msg_001',
      channelId: 'test',
      userId: 'u1',
      username: 'user',
      chatType: 'private',
      messageType: MessageType.TEXT,
      text: '',
      raw: null,
      timestamp: 0,
    };
    const result = toNormalizedMessage(msg);
    expect(result.content).toBe('');
    expect(result.messageId).toBe('msg_001');
  });

  it('undefined 文本应转为空字符串', () => {
    const msg: InboundMessage = {
      messageId: 'msg_002',
      channelId: 'test',
      userId: 'u1',
      username: 'user',
      chatType: 'private',
      messageType: MessageType.IMAGE,
      raw: {},
      timestamp: Date.now(),
    };
    const result = toNormalizedMessage(msg);
    expect(result.content).toBe('');
  });

  it('displayName 优先于 username', () => {
    const msg: InboundMessage = {
      messageId: 'msg_003',
      channelId: 'test',
      userId: 'u1',
      username: 'raw_name',
      displayName: 'Display Name',
      chatType: 'private',
      messageType: MessageType.TEXT,
      text: 'hi',
      raw: {},
      timestamp: Date.now(),
    };
    const result = toNormalizedMessage(msg);
    expect(result.userName).toBe('Display Name');
  });

  it('所有消息类型映射正确', () => {
    const types = [
      { in: MessageType.TEXT, out: 'text' as const },
      { in: MessageType.IMAGE, out: 'image' as const },
      { in: MessageType.FILE, out: 'file' as const },
      { in: MessageType.AUDIO, out: 'audio' as const },
      { in: MessageType.VIDEO, out: 'video' as const },
    ];
    for (const { in: input, out } of types) {
      const msg: InboundMessage = {
        messageId: 'm', channelId: 'c', userId: 'u', username: 'n',
        chatType: 'private', messageType: input, text: 'x', raw: {},
        timestamp: 0,
      };
      expect(toNormalizedMessage(msg).messageType).toBe(out);
    }
  });

  it('带完整附件的信息应正确转换', () => {
    const msg: InboundMessage = {
      messageId: 'msg_004',
      channelId: 'test',
      userId: 'u1',
      username: 'user',
      chatType: 'group',
      groupId: 'g1',
      groupName: 'Test Group',
      messageType: MessageType.IMAGE,
      text: '看图',
      attachments: [
        { type: 'image', url: 'http://img.jpg', filename: 'photo.jpg', size: 1024, mimeType: 'image/jpeg', width: 800, height: 600 },
        { type: 'file', url: 'http://doc.pdf', filename: 'doc.pdf', size: 2048, mimeType: 'application/pdf' },
      ],
      raw: {},
      timestamp: 1700000000000,
    };
    const result = toNormalizedMessage(msg);
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments![0].type).toBe('image');
    expect(result.attachments![0].url).toBe('http://img.jpg');
    expect(result.attachments![1].type).toBe('file');
  });
});

// ══════════════════════════════════════════════════════════════
// 消息类型边界
// ══════════════════════════════════════════════════════════════

describe('MessageType — 边界测试', () => {
  it('枚举值互不重复', () => {
    const values = Object.values(MessageType);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('STICKER/LOCATION/CONTACT 是合法消息类型', () => {
    expect(MessageType.STICKER).toBe('sticker');
    expect(MessageType.LOCATION).toBe('location');
    expect(MessageType.CONTACT).toBe('contact');
  });
});
