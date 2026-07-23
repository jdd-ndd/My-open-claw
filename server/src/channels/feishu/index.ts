/**
 * 飞书渠道适配�? */
import type { Message } from '../../core/types/index.js';
import type { ChannelProvider } from '../base.js';

/** 飞书渠道实现（占位，待集成飞书开放平�?API�?*/
export class FeishuChannel implements ChannelProvider {
  readonly id = 'feishu';

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(_message: Message): Promise<void> {}
  getStatus(): string { return 'not_implemented'; }
}
