import { useEffect, useRef, useCallback } from 'react';
import { wsClient } from '@/api/gateway';
import { useAppStore } from '@/stores/useAppStore';
import type { ConnectionStatus } from '@/types/gateway';
import { SHARED_CHANNEL_ID, SHARED_USER_ID } from '@/config/sync-defaults';

export function useWebSocket() {
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus);
  const connectedRef = useRef(false);
  const boundRef = useRef(false);

  const connect = useCallback(async () => {
    if (connectedRef.current) return;
    try {
      await wsClient.connect();
      connectedRef.current = true;

      // 关键：连接建立后立即发送 session.bind，将 channelId/userId 绑定到 WebSocket 连接
      // 这样服务器才能通过 broadcastToChannel 将跨端会话变更事件广播到本端
      if (!boundRef.current) {
        try {
          await wsClient.request('session.bind', {
            sessionId: null,
            channelId: SHARED_CHANNEL_ID,
            userId: SHARED_USER_ID,
          });
          boundRef.current = true;
          console.log('[useWebSocket] session.bind 成功，channelId:', SHARED_CHANNEL_ID);
        } catch (bindErr) {
          console.warn('[useWebSocket] session.bind 失败（不阻断主流程）:', bindErr);
        }
      }
    } catch (err) {
      console.error('[useWebSocket] 连接失败:', err);
      connectedRef.current = false;
    }
  }, []);

  const disconnect = useCallback(() => {
    wsClient.disconnect();
    connectedRef.current = false;
    boundRef.current = false;
  }, []);

  useEffect(() => {
    const unsub = wsClient.onStateChange((state: ConnectionStatus) => {
      setConnectionStatus(state);
    });

    return () => {
      unsub();
    };
  }, [setConnectionStatus]);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    connect,
    disconnect,
    connectionStatus: useAppStore((s) => s.connectionStatus),
    wsClient,
  };
}
