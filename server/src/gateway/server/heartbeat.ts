/**
 * WebSocket 心跳保活模块
 *
 * 仅发送 WebSocket ping 帧保活，减少无用流量；
 * 同时清理已关闭/关闭中的连接，保持连接池健康。
 *
 * @module @myopenclaw/server/gateway/server
 */

import { WebSocket } from 'ws';
import { createLogger } from '../../core/utils/logger.js';
import type { ConnectionStore } from './connection-store.js';

const log = createLogger('gateway:heartbeat');

/**
 * 启动心跳定时器
 *
 * @param store 连接存储实例
 * @param interval 心跳间隔（毫秒）
 * @returns 定时器引用
 */
export function startHeartbeat(
  store: ConnectionStore,
  interval: number
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    let aliveCount = 0;

    for (const [connectionId, ws] of store.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
          aliveCount++;
        } catch {
          log.warn({ connectionId }, '心跳 ping 失败');
          store.delete(connectionId);
          ws.terminate();
        }
      } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        store.delete(connectionId);
      }
    }

    log.debug({ aliveCount, total: store.size }, '心跳完成');
  }, interval);

  log.debug({ interval }, '心跳定时器已启动');
  return timer;
}

/**
 * 停止心跳定时器
 *
 * @param timer 定时器引用
 */
export function stopHeartbeat(timer: ReturnType<typeof setInterval> | null): void {
  if (timer) {
    clearInterval(timer);
  }
}
