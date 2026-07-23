/**
 * Telegram 渠道适配�? */
import type { Message } from '../../core/types/index.js';
import type { ChannelProvider } from '../base.js';

/** Telegram 渠道实现（占位，待集�?Telegram Bot API�?*/
export class TelegramChannel implements ChannelProvider {
  readonly id = 'telegram';

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(_message: Message): Promise<void> {}
  getStatus(): string { return 'not_implemented'; }
}
