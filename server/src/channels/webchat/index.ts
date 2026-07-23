/**
 * WebChat 渠道适配�? *
 * 内置浏览器端 WebSocket 直连渠道�? */
import type { Message } from '../../core/types/index.js';
import type { ChannelProvider } from '../base.js';

/** WebChat 渠道实现（占位，待集�?Gateway WebSocket�?*/
export class WebChatChannel implements ChannelProvider {
  readonly id = 'webchat';

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(_message: Message): Promise<void> {}
  getStatus(): string { return 'not_implemented'; }
}
