/**
 * ChannelProvider �?渠道统一接口定义
 *
 * 所有渠道适配器必须实现此接口�? * 每个渠道的职责：将外部平台的原始消息转换为框架标�?Message，并�?Agent 回复回传�? *
 * @module @myopenclaw/server/channels
 */

import type { Message } from '../core/types/index.js';

export interface ChannelProvider {
  readonly id: string;

  /** 启动渠道，开始监听外部连�?*/
  start(): Promise<void>;

  /** 停止渠道，释放所有资�?*/
  stop(): Promise<void>;

  /** 向该渠道发送消息（Agent 响应回传�?*/
  send(message: Message): Promise<void>;

  /** 获取渠道当前状�?*/
  getStatus(): string;
}
