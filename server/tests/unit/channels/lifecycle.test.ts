/**
 * 生命周期状态管理单元测试
 *
 * @module server/tests/unit/channels
 */

import { describe, it, expect } from 'vitest';
import {
  canTransition,
  transition,
  safeTransition,
  isRunningState,
  canBecomeRunning,
  isTerminalState,
  isErrorState,
  describeState,
} from '../../../src/channels/lifecycle.js';
import { ChannelLifecycleState as State } from '../../../src/channels/types.js';

describe('canTransition', () => {
  it('应该允许合法的状态转换', () => {
    expect(canTransition(State.UNINITIALIZED, State.INITIALIZED)).toBe(true);
    expect(canTransition(State.INITIALIZED, State.CONNECTING)).toBe(true);
    expect(canTransition(State.CONNECTING, State.CONNECTED)).toBe(true);
    expect(canTransition(State.CONNECTING, State.ERROR)).toBe(true);
    expect(canTransition(State.CONNECTED, State.DISCONNECTING)).toBe(true);
    expect(canTransition(State.CONNECTED, State.RECONNECTING)).toBe(true);
    expect(canTransition(State.DISCONNECTING, State.STOPPED)).toBe(true);
    expect(canTransition(State.ERROR, State.RECONNECTING)).toBe(true);
    expect(canTransition(State.ERROR, State.STOPPED)).toBe(true);
    expect(canTransition(State.RECONNECTING, State.CONNECTED)).toBe(true);
    expect(canTransition(State.RECONNECTING, State.ERROR)).toBe(true);
  });

  it('应该拒绝非法的状态转换', () => {
    expect(canTransition(State.UNINITIALIZED, State.CONNECTED)).toBe(false);
    expect(canTransition(State.CONNECTED, State.UNINITIALIZED)).toBe(false);
    expect(canTransition(State.STOPPED, State.CONNECTED)).toBe(false);
    expect(canTransition(State.ERROR, State.CONNECTED)).toBe(false);
    expect(canTransition(State.CONNECTED, State.CONNECTED)).toBe(false);
  });
});

describe('transition', () => {
  it('应该执行合法的状态转换', () => {
    expect(transition(State.UNINITIALIZED, State.INITIALIZED)).toBe(State.INITIALIZED);
    expect(transition(State.INITIALIZED, State.CONNECTING)).toBe(State.CONNECTING);
  });

  it('非法的状态转换应该抛出错误', () => {
    expect(() => transition(State.UNINITIALIZED, State.CONNECTED)).toThrow(
      '非法的状态转换',
    );
    expect(() => transition(State.STOPPED, State.CONNECTED)).toThrow(
      '非法的状态转换',
    );
  });
});

describe('safeTransition', () => {
  it('合法转换应该返回新状态', () => {
    expect(safeTransition(State.UNINITIALIZED, State.INITIALIZED)).toBe(State.INITIALIZED);
  });

  it('非法转换应该返回原始状态（不抛异常）', () => {
    expect(safeTransition(State.UNINITIALIZED, State.CONNECTED)).toBe(State.UNINITIALIZED);
    expect(safeTransition(State.STOPPED, State.CONNECTED)).toBe(State.STOPPED);
  });
});

describe('isRunningState', () => {
  it('CONNECTED 应为运行中', () => {
    expect(isRunningState(State.CONNECTED)).toBe(true);
  });

  it('非 CONNECTED 应为非运行中', () => {
    expect(isRunningState(State.UNINITIALIZED)).toBe(false);
    expect(isRunningState(State.ERROR)).toBe(false);
    expect(isRunningState(State.STOPPED)).toBe(false);
  });
});

describe('canBecomeRunning', () => {
  it('已初始化、已断开或错误状态可以转为运行', () => {
    expect(canBecomeRunning(State.INITIALIZED)).toBe(true);
    expect(canBecomeRunning(State.DISCONNECTED)).toBe(true);
    expect(canBecomeRunning(State.ERROR)).toBe(true);
  });

  it('已连接状态不能再转为运行', () => {
    expect(canBecomeRunning(State.CONNECTED)).toBe(false);
  });
});

describe('isTerminalState', () => {
  it('STOPPED 为终态', () => {
    expect(isTerminalState(State.STOPPED)).toBe(true);
  });

  it('其他状态不为终态', () => {
    expect(isTerminalState(State.CONNECTED)).toBe(false);
  });
});

describe('isErrorState', () => {
  it('ERROR 为错误状态', () => {
    expect(isErrorState(State.ERROR)).toBe(true);
  });
});

describe('describeState', () => {
  it('应该返回中文描述', () => {
    expect(describeState(State.UNINITIALIZED)).toBe('未初始化');
    expect(describeState(State.CONNECTED)).toBe('已连接');
    expect(describeState(State.ERROR)).toBe('错误');
  });
});
