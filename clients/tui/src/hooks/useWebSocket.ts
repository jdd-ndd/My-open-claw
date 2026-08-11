/**
 * WebSocket 客户端 Hook
 * 对接 server/src/gateway/server/gateway-server.ts
 *
 * 特性:
 * - 使用 ws 库(Node 端原生 WebSocket)
 * - 连接时附加 ?token=<jwt> 鉴权
 * - 客户端主动 ping 心跳
 * - 指数退避自动重连
 * - Promise-based request/response 关联
 *
 * 修复:
 * - 删除无消费的 `events` 状态(死代码 + 每次 event 都触发 setState 引起重渲染)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebSocket } from 'ws';
import type { ConnectionState } from '../types/ui.js';
import {
  type EventMessage,
  type RequestMessage,
  buildRequest,
  isResponse,
} from '../types/message.js';

export interface UseWebSocketOptions {
  url: string;
  token?: string;
  autoConnect?: boolean;
  heartbeatIntervalMs?: number;
  reconnectMaxDelayMs?: number;
  onConnect?: () => void;
  onDisconnect?: (code: number, reason: string) => void;
}

export interface UseWebSocketResult {
  connectionState: ConnectionState;
  /** 当前活跃会话 ID(由 server 通过 chat.* 事件携带) */
  activeSessionId: string | null;
  /** 发送 Request 并等待对应 Response */
  request: <T = unknown>(action: string, payload: Record<string, unknown>, timeoutMs?: number) => Promise<T>;
  /** 发送单次消息(不等待响应) */
  send: (msg: RequestMessage) => boolean;
  /** 手动重连 */
  reconnect: () => void;
  /** 主动关闭(不再自动重连) */
  disconnect: () => void;
  /** 订阅 event 消息,返回取消订阅函数 */
  onEvent: (handler: (event: EventMessage) => void) => () => void;
}

const DEFAULT_HEARTBEAT = 25_000;
const DEFAULT_MAX_RECONNECT_DELAY = 30_000;

export function useWebSocket(opts: UseWebSocketOptions): UseWebSocketResult {
  const {
    url,
    token,
    autoConnect = true,
    heartbeatIntervalMs = DEFAULT_HEARTBEAT,
    reconnectMaxDelayMs = DEFAULT_MAX_RECONNECT_DELAY,
    onConnect,
    onDisconnect,
  } = opts;

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1_000);
  const wantConnectedRef = useRef(autoConnect);
  const shouldReconnectRef = useRef(true);
  const pendingRef = useRef<
    Map<
      string,
      {
        resolve: (v: unknown) => void;
        reject: (e: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >
  >(new Map());

  const eventSubsRef = useRef<Set<(event: EventMessage) => void>>(new Set());

  // 回调 ref:避免 hook 内部闭包过期
  const onConnectRef = useRef(onConnect);
  onConnectRef.current = onConnect;
  const onDisconnectRef = useRef(onDisconnect);
  onDisconnectRef.current = onDisconnect;

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    clearHeartbeat();
    heartbeatTimerRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.ping();
      } catch {
        // 心跳失败,等 server 主动 close
      }
    }, heartbeatIntervalMs);
  }, [clearHeartbeat, heartbeatIntervalMs]);

  const rejectAllPending = useCallback((reason: string) => {
    for (const [, p] of pendingRef.current) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    pendingRef.current.clear();
  }, []);

  const connect = useCallback(() => {
    if (!shouldReconnectRef.current) return;
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // 拼接 token
    let fullUrl = url;
    if (token) {
      const sep = url.includes('?') ? '&' : '?';
      fullUrl = `${url}${sep}token=${encodeURIComponent(token)}`;
    }

    setConnectionState('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(fullUrl);
    } catch {
      setConnectionState('disconnected');
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.on('open', () => {
      setConnectionState('connected');
      reconnectDelayRef.current = 1_000;
      startHeartbeat();
      onConnectRef.current?.();
    });

    ws.on('message', (raw) => {
      let msg: import('../types/message.js').GatewayMessage;
      try {
        msg = JSON.parse(raw.toString()) as import('../types/message.js').GatewayMessage;
      } catch {
        return;
      }

      if (isResponse(msg)) {
        const pending = pendingRef.current.get(msg.requestId);
        if (pending) {
          pendingRef.current.delete(msg.requestId);
          clearTimeout(pending.timer);
          if (msg.status === 'success') {
            pending.resolve(msg.payload);
          } else {
            pending.reject(new Error(msg.errorMessage ?? msg.errorCode ?? 'request failed'));
          }
        }
        return;
      }

      if (msg.type === 'event') {
        const evt = msg as EventMessage;
        // 同步活跃 sessionId
        const p = evt.payload as { sessionId?: string };
        if (typeof p?.sessionId === 'string') {
          setActiveSessionId(p.sessionId);
        }
        // 通知所有订阅者(不引入 setState,避免不必要重渲染)
        for (const sub of eventSubsRef.current) {
          try {
            sub(evt);
          } catch {
            /* ignore */
          }
        }
        return;
      }
    });

    ws.on('close', (code, reasonBuf) => {
      const reason = reasonBuf.toString();
      setConnectionState('disconnected');
      clearHeartbeat();
      rejectAllPending(`ws closed (${code}): ${reason}`);
      onDisconnectRef.current?.(code, reason);
      if (shouldReconnectRef.current && wantConnectedRef.current) {
        scheduleReconnect();
      }
    });

    ws.on('error', () => {
      // error 通常伴随 close,无需重复处理
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, token, startHeartbeat, clearHeartbeat, rejectAllPending]);

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current || !wantConnectedRef.current) return;
    if (reconnectTimerRef.current) return;
    const delay = Math.min(reconnectDelayRef.current, reconnectMaxDelayMs);
    reconnectDelayRef.current = Math.min(delay * 2, reconnectMaxDelayMs);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }, [connect, reconnectMaxDelayMs]);

  const reconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    wantConnectedRef.current = true;
    reconnectDelayRef.current = 1_000;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    try {
      wsRef.current?.terminate();
    } catch {
      /* noop */
    }
    wsRef.current = null;
    connect();
  }, [connect]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    wantConnectedRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    clearHeartbeat();
    try {
      wsRef.current?.close(1000, 'client disconnect');
    } catch {
      /* noop */
    }
    wsRef.current = null;
    setConnectionState('disconnected');
  }, [clearHeartbeat]);

  const request = useCallback(
    <T = unknown,>(action: string, payload: Record<string, unknown>, timeoutMs = 30_000): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          reject(new Error('ws not connected'));
          return;
        }
        const msg = buildRequest(action, payload);
        const timer = setTimeout(() => {
          pendingRef.current.delete(msg.id);
          reject(new Error(`request ${action} timeout`));
        }, timeoutMs);
        pendingRef.current.set(msg.id, { resolve: resolve as (v: unknown) => void, reject, timer });
        try {
          ws.send(JSON.stringify(msg));
        } catch (err) {
          clearTimeout(timer);
          pendingRef.current.delete(msg.id);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    [],
  );

  const send = useCallback((msg: RequestMessage): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }, []);

  // 自动连接
  useEffect(() => {
    if (!autoConnect) return;
    wantConnectedRef.current = true;
    shouldReconnectRef.current = true;
    connect();
    return () => {
      shouldReconnectRef.current = false;
      wantConnectedRef.current = false;
      clearHeartbeat();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      rejectAllPending('unmount');
      try {
        wsRef.current?.close(1000, 'unmount');
      } catch {
        /* noop */
      }
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, token, autoConnect]);

  return useMemo(
    () => ({
      connectionState,
      activeSessionId,
      request,
      send,
      reconnect,
      disconnect,
      onEvent: (handler: (event: EventMessage) => void) => {
        const wrapped = (event: EventMessage) => handler(event);
        eventSubsRef.current.add(wrapped);
        return () => {
          eventSubsRef.current.delete(wrapped);
        };
      },
    }),
    [connectionState, activeSessionId, request, send, reconnect, disconnect],
  );
}
