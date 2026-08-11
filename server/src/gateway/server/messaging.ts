/**
 * WebSocket message delivery helpers.
 */

import { WebSocket } from 'ws';
import { createLogger } from '../../core/utils/logger.js';
import type { ConnectionStore } from './connection-store.js';
import type { GatewayMessage } from '../protocol.js';

const log = createLogger('gateway:messaging');

export interface BroadcastResult {
  sent: number;
  total: number;
}

export interface Messenger {
  send(connectionId: string, message: GatewayMessage): void;
  broadcast(message: GatewayMessage): BroadcastResult;
  broadcastToSession(sessionId: string, message: GatewayMessage): BroadcastResult;
  /**
   * 向指定渠道下的所有连接广播消息（用于跨端会话变更通知）
   *
   * @param channelId 渠道 ID
   * @param message 待广播的消息
   * @param excludeConnectionIds 可选，需排除的连接 ID 集合（避免重复发送）
   */
  broadcastToChannel(channelId: string, message: GatewayMessage, excludeConnectionIds?: Set<string>): BroadcastResult;
}

export function createMessenger(store: ConnectionStore): Messenger {
  const sendMessage = (connectionId: string, message: GatewayMessage): boolean => {
    const ws = store.get(connectionId);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log.warn({ connectionId, readyState: ws?.readyState }, 'Unable to send message to closed connection');
      return false;
    }

    if (ws.bufferedAmount > 64 * 1024) {
      log.warn({ connectionId, bufferedAmount: ws.bufferedAmount }, 'Dropping message because socket buffer is full');
      return false;
    }

    try {
      ws.send(JSON.stringify(message));
      log.debug({ connectionId, type: message.type, id: message.id }, 'Message sent');
      return true;
    } catch (err) {
      log.error({ connectionId, error: (err as Error).message }, 'Failed to send message');
      return false;
    }
  };

  return {
    send(connectionId: string, message: GatewayMessage): void {
      sendMessage(connectionId, message);
    },

    broadcast(message: GatewayMessage): BroadcastResult {
      let sentCount = 0;

      for (const [connectionId] of store.entries()) {
        if (sendMessage(connectionId, message)) {
          sentCount++;
        }
      }

      log.debug({ sentCount, total: store.size }, 'Broadcast complete');
      return { sent: sentCount, total: store.size };
    },

    broadcastToSession(sessionId: string, message: GatewayMessage): BroadcastResult {
      const connectionIds = store.getConnectionIdsBySession(sessionId);
      let sentCount = 0;

      for (const connectionId of connectionIds) {
        if (sendMessage(connectionId, message)) {
          sentCount++;
        }
      }

      log.debug({ sessionId, sentCount, total: connectionIds.length }, 'Session broadcast complete');
      return { sent: sentCount, total: connectionIds.length };
    },

    broadcastToChannel(channelId: string, message: GatewayMessage, excludeConnectionIds?: Set<string>): BroadcastResult {
      const connectionIds = store.getConnectionIdsByChannel(channelId, excludeConnectionIds);
      let sentCount = 0;

      for (const connectionId of connectionIds) {
        if (sendMessage(connectionId, message)) {
          sentCount++;
        }
      }

      log.debug({ channelId, sentCount, total: connectionIds.length }, 'Channel broadcast complete');
      return { sent: sentCount, total: connectionIds.length };
    },
  };
}
