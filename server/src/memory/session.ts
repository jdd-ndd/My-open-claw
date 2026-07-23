/**
 * 短期会话记忆（Session Memory）
 */
import { createLogger } from '../core/utils/logger.js';
import type { Message } from '../core/types/index.js';

const log = createLogger('memory:session');

export class SessionMemory {
  private cache = new Map<string, Message[]>();

  /** 读取会话消息 */
  async read(sessionId: string): Promise<Message[]> {
    return this.cache.get(sessionId) ?? [];
  }

  /** 追加会话消息 */
  async append(sessionId: string, message: Message): Promise<void> {
    const messages = this.cache.get(sessionId) ?? [];
    messages.push(message);
    this.cache.set(sessionId, messages);
    log.debug({ sessionId, messageId: message.id }, '会话记忆已更新');
  }
}
