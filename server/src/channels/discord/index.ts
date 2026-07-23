/**
 * Discord 渠道适配�? */
import type { Message } from '../../core/types/index.js';
import type { ChannelProvider } from '../base.js';

/** Discord 渠道实现（占位，待集�?Discord API�?*/
export class DiscordChannel implements ChannelProvider {
  readonly id = 'discord';

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(_message: Message): Promise<void> {}
  getStatus(): string { return 'not_implemented'; }
}
