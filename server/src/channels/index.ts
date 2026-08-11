/**
 * Channels 渠道模块 — 统一聚合导出
 *
 * @module @myopenclaw/server/channels
 */

// ── 核心类型 ──
export {
  MessageType,
  ChannelLifecycleState,
  DEFAULT_RECONNECT_CONFIG,
  createDefaultChannelStats,
} from './types.js';

export type {
  MessageAttachment,
  MessageButton,
  MessageTarget,
  SendMessageResult,
  InboundMessage,
  OutboundMessage,
  ChannelCapabilities,
  ChannelStats,
  ChannelStatus,
  ReconnectConfig,
  ChannelConfig,
  ChannelLogger,
  ChannelContext,
} from './types.js';

// ── 基础接口 ──
export { toNormalizedMessage } from './base.js';
export type { ChannelProvider, LegacyChannelProvider } from './base.js';

// ── 生命周期 ──
export {
  canTransition,
  transition,
  safeTransition,
  isRunningState,
  canBecomeRunning,
  isTerminalState,
  isErrorState,
  describeState,
} from './lifecycle.js';

// ── 重连管理器 ──
export { ReconnectManager } from './reconnect.js';
export type { Reconnectable } from './reconnect.js';

// ── 渠道管理器 ──
export { ChannelManager } from './manager.js';
export type { ChannelProviderFactory, ChannelManagerOptions } from './manager.js';

// ── 渠道 Provider ──
export { QQBotChannel } from './qqbot/index.js';
export { FeishuChannel } from './feishu/index.js';
export { WeChatChannel } from './wechat/index.js';

// ── 归一化器 ──
export { normalizeQQBotMessage } from './qqbot/normalizer.js';
export type { QQBotPayload, QQBotMessageData, QQBotConfig } from './qqbot/normalizer.js';

export { normalizeFeishuMessage, extractFeishuPostText as _extractFeishuPostText } from './feishu/normalizer.js';
export type { FeishuEvent } from './feishu/normalizer.js';

export { normalizeWeChatMessage, parseWeChatXml } from './wechat/normalizer.js';
export type { WeChatMessage, WeComJsonMessage } from './wechat/normalizer.js';

// ── 渠道引导器（生产入口） ──
export { ChannelsBootstrap } from './bootstrap.js';
export type { ChannelsBootstrapDeps } from './bootstrap.js';

// ── 向后兼容：旧版骨架渠道 ──
export { WebChatChannel } from './webchat/index.js';
export { CliChannel } from './cli/index.js';
