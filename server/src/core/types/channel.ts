/**
 * 渠道相关类型定义
 *
 * @module @myopenclaw/server/core/types
 */

import type { Message } from './message.js';

/** 渠道状态枚举 */
export type ChannelStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/** 渠道配置 */
export interface ChannelConfig {
  id: string;
  name: string;
  enabled: boolean;
  onMessage: (message: Message) => Promise<void>;
  [key: string]: unknown;
}

/** 渠道接口 */
export interface ChannelProvider {
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: Message): Promise<void>;
  getStatus(): string;
}
