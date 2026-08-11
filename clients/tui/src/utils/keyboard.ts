/**
 * 键盘事件辅助判断
 * 与 Ink 的 useInput 输入对齐
 */

import type { Key } from 'ink';

export function isCtrl(value: string, key: Key): boolean {
  return key.ctrl && value.length === 1 && value.charCodeAt(0) >= 1 && value.charCodeAt(0) <= 26;
}

export function isCtrlP(value: string, key: Key): boolean {
  return key.ctrl && value === 'p';
}

export function isCtrlC(value: string, key: Key): boolean {
  return key.ctrl && value === 'c';
}

export function isEnter(key: Key): boolean {
  return key.return && !key.shift;
}

export function isShiftEnter(key: Key): boolean {
  return key.return && key.shift;
}
