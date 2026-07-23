/**
 * 消息发送与广播模块
 *
 * 负责向指定连接发送消息或向所有在线连接广播消息，
 * 统一处理连接可用性检查、背压保护与异常日志。
 *
 * @module @myopenclaw/server/gateway/server
 */

import { WebSocket } from 'ws';
import { createLogger } from '../../core/utils/logger.js';
import type { ConnectionStore } from './connection-store.js';
import type { GatewayMessage } from '../protocol.js';

const log = createLogger('gateway:messaging');

/**
 * 广播统计
 */
export interface BroadcastResult {
  /** 成功发送数量 */
  sent: number;
  /** 总连接数 */
  total: number;
}

/**
 * 消息发送器接口
 */
export interface Messenger {
  /**
   * 向指定连接发送消息
   */
  send(connectionId: string, message: GatewayMessage): void;

  /**
   * 向所有已连接客户端广播消息
   */
  broadcast(message: GatewayMessage): BroadcastResult;
}

/**
 * 创建消息发送器
 *
 * @param store 连接存储实例
 * @returns Messenger 实例
 */
export function createMessenger(store: ConnectionStore): Messenger {
  return {
    /**
     * 向指定连接发送消息
     */
    send(connectionId: string, message: GatewayMessage): void {
      const ws = store.get(connectionId);

      if (!ws || ws.readyState !== WebSocket.OPEN) {
        log.warn({ connectionId, readyState: ws?.readyState }, '无法发送消息：连接不可用');
        return;
      }

      // 背压检查
      if (ws.bufferedAmount > 64 * 1024) {
        log.warn({ connectionId, bufferedAmount: ws.bufferedAmount }, '发送缓冲区溢出，丢弃消息');
        return;
      }

      try {
        ws.send(JSON.stringify(message));
        log.debug({ connectionId, type: message.type, id: message.id }, '消息已发送');
      } catch (err) {
        log.error({ connectionId, error: (err as Error).message }, '发送消息失败');
      }
    },

    /**
     * 向所有已连接客户端广播消息
     */
    broadcast(message: GatewayMessage): BroadcastResult {
      let sentCount = 0;

      for (const [connectionId, ws] of store.entries()) {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(message));
            sentCount++;
          } catch {
            log.warn({ connectionId }, '广播发送失败');
          }
        }
      }

      log.debug({ sentCount, total: store.size }, '广播完成');
      return { sent: sentCount, total: store.size };
    },
  };
}
