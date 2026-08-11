/**
 * 渠道生命周期状态管理
 *
 * 提供渠道生命周期状态的转换逻辑和验证。
 * 严格遵循状态转换图（见文档第 7.4 节）。
 *
 * @module @myopenclaw/server/channels
 */

import { ChannelLifecycleState as State } from './types.js';

/**
 * 允许的状态转换表
 *
 * 定义了从每个状态可以合法转换到的目标状态集合。
 * 任何不在此表中的状态转换将被视为非法操作。
 */
const ALLOWED_TRANSITIONS: Record<State, Set<State>> = {
  [State.UNINITIALIZED]: new Set([State.INITIALIZED]),
  [State.INITIALIZED]: new Set([State.CONNECTING]),
  [State.CONNECTING]: new Set([State.CONNECTED, State.ERROR]),
  [State.CONNECTED]: new Set([State.DISCONNECTING, State.RECONNECTING, State.DISCONNECTED]),
  [State.DISCONNECTING]: new Set([State.STOPPED, State.DISCONNECTED]),
  [State.DISCONNECTED]: new Set([State.RECONNECTING, State.CONNECTING, State.STOPPED]),
  [State.RECONNECTING]: new Set([State.CONNECTED, State.ERROR, State.DISCONNECTING]),
  [State.ERROR]: new Set([State.RECONNECTING, State.STOPPED]),
  [State.STOPPED]: new Set(),
};

/**
 * 检查状态转换是否合法
 *
 * @param from - 当前状态
 * @param to - 目标状态
 * @returns true 表示可以转换
 */
export function canTransition(from: State, to: State): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed?.has(to) ?? false;
}

/**
 * 执行状态转换
 *
 * 如果转换非法，将抛出错误。
 *
 * @param currentState - 当前状态
 * @param newState - 目标状态
 * @returns 目标状态
 * @throws 如果状态转换非法
 */
export function transition(currentState: State, newState: State): State {
  if (!canTransition(currentState, newState)) {
    throw new Error(
      `非法的状态转换: ${currentState} → ${newState}。` +
      `允许从 ${currentState} 转换到: ${[...(ALLOWED_TRANSITIONS[currentState] ?? [])].join(', ') || '(无)'}`,
    );
  }
  return newState;
}

/**
 * 安全执行状态转换（不抛出异常）
 *
 * @param currentState - 当前状态
 * @param newState - 目标状态
 * @returns 如果转换合法返回新状态，否则返回当前状态
 */
export function safeTransition(currentState: State, newState: State): State {
  return canTransition(currentState, newState) ? newState : currentState;
}

/**
 * 判断状态是否为运行中状态
 */
export function isRunningState(state: State): boolean {
  return state === State.CONNECTED;
}

/**
 * 判断状态是否可转为运行状态
 */
export function canBecomeRunning(state: State): boolean {
  return state === State.INITIALIZED || state === State.DISCONNECTED || state === State.ERROR;
}

/**
 * 判断状态是否为终态（不再变化）
 */
export function isTerminalState(state: State): boolean {
  return state === State.STOPPED;
}

/**
 * 判断状态是否为错误状态
 */
export function isErrorState(state: State): boolean {
  return state === State.ERROR;
}

/**
 * 获取状态的人类可读描述
 */
export function describeState(state: State): string {
  const descriptions: Record<State, string> = {
    [State.UNINITIALIZED]: '未初始化',
    [State.INITIALIZED]: '已初始化',
    [State.CONNECTING]: '连接中',
    [State.CONNECTED]: '已连接',
    [State.DISCONNECTING]: '断开中',
    [State.DISCONNECTED]: '已断开',
    [State.RECONNECTING]: '重连中',
    [State.ERROR]: '错误',
    [State.STOPPED]: '已停止',
  };
  return descriptions[state] ?? state;
}
