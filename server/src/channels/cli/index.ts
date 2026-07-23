/**
 * CLI 渠道适配�? */
import type { Message } from '../../core/types/index.js';
import type { ChannelProvider } from '../base.js';

/** CLI 渠道实现（占位，待实现命令行交互�?*/
export class CliChannel implements ChannelProvider {
  readonly id = 'cli';

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(_message: Message): Promise<void> {}
  getStatus(): string { return 'not_implemented'; }
}
