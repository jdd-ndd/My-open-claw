/**
 * TUI 客户端入口
 *
 * 关键修复(对比上一版):某些环境(嵌套 terminal、VS Code 集成终端、PowerShell
 *   ISE 等)对 alternate screen buffer (\x1b[?1049h) 序列响应异常,导致 Ink
 *   每帧重绘都把整帧追加到 stdout,造成"双层 TUI"或"页面堆叠"假象。
 * 解决方法:包一层 process.stdout.write,拦截 Ink 帧开头的 \x1b[H 序列,
 *   在前面注入 \x1b[2J\x1b[3J(清可见区 + 清 scrollback),模拟 alternate buffer
 *   的清屏行为。
 */
import { render } from 'ink';
import React from 'react';
import { App } from './components/App.js';
import { defaultConfig } from './config/defaults.js';

// ---------------------------------------------------------------------------
// 0. 启动时:清屏 + 隐藏光标 + 切到 alternate buffer(如果支持)
// ---------------------------------------------------------------------------
if (process.stdout.isTTY) {
  // 1) 清可见区 + scrollback + 光标归位
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
  // 2) 隐藏光标(可选,看起来更专业;清理时再恢复)
  process.stdout.write('\x1b[?25l');
  // 3) 尝试进 alternate buffer,某些 terminal 会响应
  process.stdout.write('\x1b[?1049h');
  // 4) 再次清屏(进入 alternate buffer 后原屏幕内容已被隔离)
  process.stdout.write('\x1b[2J\x1b[H');
  // 5) 启用 SGR mouse tracking(滚轮 + 点击 + 拖动)
  //    \x1b[?1002h = button-event tracking(只发 button press/release +
  //      按住按钮期间的 motion;空闲移动不发,避免 noise)
  //    \x1b[?1006h = SGR encoding
  //    如果 terminal 不兼容,设 TUI_NO_MOUSE=1 关闭
  if (process.env.TUI_NO_MOUSE !== '1') {
    process.stdout.write('\x1b[?1002h\x1b[?1006h');
  }
}

// ---------------------------------------------------------------------------
// 0.5. 包一层 stdout.write —— 模拟 alternate buffer 行为
// ---------------------------------------------------------------------------
// Ink 每帧的开头是 \x1b[H(光标移到原点,行=0,列=0)。
// 如果 alternate buffer 没生效,后续帧会**追加**到 stdout 上,造成内容堆叠。
// 我们在写每帧前注入清屏指令,保证每帧从干净状态开始绘制。
const realWrite = process.stdout.write.bind(process.stdout);
let inFrameClear = false;

(process.stdout as any).write = function patchedWrite(
  chunk: any,
  ...args: any[]
): boolean {
  const str = typeof chunk === 'string' ? chunk : (chunk?.toString?.() ?? '');
  // 拦截条件:
  // - 不在 already-injected-clear 状态(避免递归)
  // - 输出包含 \x1b[H (Ink 帧开头)
  // - 不是控制序列(alternate buffer / cursor 模式 / 自己的清屏)
  if (
    !inFrameClear &&
    str.length > 0 &&
    str.includes('\x1b[H') &&
    !str.startsWith('\x1b[?25') && // 隐藏/显示光标
    !str.startsWith('\x1b[?1049') && // alternate buffer 切换
    !str.startsWith('\x1b[2J') && // 自己已经在清屏
    !str.startsWith('\x1b[3J')
  ) {
    inFrameClear = true;
    try {
      // 在 Ink 写之前注入清屏
      return realWrite('\x1b[2J\x1b[3J' + str, ...args);
    } finally {
      inFrameClear = false;
    }
  }
  return realWrite(chunk, ...args);
} as typeof process.stdout.write;

// ---------------------------------------------------------------------------
// 1. 启用 stdin raw mode
// ---------------------------------------------------------------------------
const stdinAny = process.stdin as any;
const supportsRawMode = typeof stdinAny.setRawMode === 'function';

if (supportsRawMode) {
  try {
    stdinAny.setRawMode(true);
  } catch {
    // 静默
  }
} else if (process.stdin.isTTY) {
  try {
    const readline = await import('node:readline');
    readline.emitKeypressEvents(process.stdin);
  } catch {
    // 静默
  }
}

process.stdin.resume();
try {
  const readline = await import('node:readline');
  readline.emitKeypressEvents(process.stdin);
} catch {
  // 静默
}

if (process.stdin.isTTY && supportsRawMode) {
  try {
    (process.stdin as any).setRawMode(true);
  } catch {
    // noop
  }
}

// ---------------------------------------------------------------------------
// 2. 解析环境变量
// ---------------------------------------------------------------------------
const token = process.env.TUI_TOKEN;
const sessionId = process.env.TUI_SESSION_ID ?? defaultConfig.defaultSessionId;
const channelId = process.env.TUI_CHANNEL_ID ?? 'tui';
const userId = process.env.TUI_USER_ID ?? defaultConfig.userId;
const mockFallback = (process.env.TUI_MOCK ?? 'false') === 'true';

// ---------------------------------------------------------------------------
// 3. 渲染应用
// ---------------------------------------------------------------------------
const cli = render(React.createElement(App, {
  gatewayUrl: defaultConfig.gatewayUrl,
  token,
  sessionId,
  channelId,
  userId,
  mockFallback,
}));

// ---------------------------------------------------------------------------
// 4. 优雅退出
// ---------------------------------------------------------------------------
let exiting = false;
const cleanup = (code: number) => {
  if (exiting) return;
  exiting = true;
  try {
    cli.unmount?.();
  } catch {
    /* noop */
  }
  if (process.stdin.isTTY && typeof (process.stdin as any).setRawMode === 'function') {
    try {
      (process.stdin as any).setRawMode(false);
    } catch {
      /* noop */
    }
  }
  // 恢复 alternate buffer + 复位光标
  if (process.stdout.isTTY) {
    try {
      // 关闭 mouse tracking
      process.stdout.write('\x1b[?1002l\x1b[?1006l');
      process.stdout.write('\x1b[?1049l'); // 退 alternate buffer
      process.stdout.write('\x1b[?25h'); // 显示光标
      process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); // 清屏
    } catch {
      /* noop */
    }
  }
  process.exit(code);
};

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
process.on('SIGHUP', () => cleanup(0));

await cli.waitUntilExit?.().catch(() => undefined);
cleanup(0);
