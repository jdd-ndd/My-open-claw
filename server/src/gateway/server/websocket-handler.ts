/**
 * WebSocket 连接与消息处理模块
 *
 * 负责处理新的 WebSocket 连接建立、消息接收、JSON 解析、
 * 背压检查、消息路由及错误响应，与旧版 API 完全兼容。
 *
 * @module @myopenclaw/server/gateway/server
 */

import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { EventEmitter } from 'node:events';
import { createLogger } from '../../core/utils/logger.js';
import { MessageRouter } from '../router/index.js';
import type { ConnectionStore } from './connection-store.js';
import type { Messenger } from './messaging.js';
import type { GatewayMessage, RequestMessage, ResponseMessage } from '../protocol.js';
import type { NormalizedMessage } from '../router/types.js';

const log = createLogger('gateway:websocket-handler');

/**
 * WebSocket 处理器依赖
 */
export interface WebSocketHandlerDeps {
  /** 连接存储 */
  store: ConnectionStore;
  /** 消息路由器 */
  router: MessageRouter;
  /** 最大允许消息体长度（字节） */
  maxMessageSize: number;
  /** 事件发射器（用于触发 connection / disconnection / message / error 事件） */
  emitter: EventEmitter;
  /** 消息发送器 */
  messenger: Messenger;
  /** 最大连接数（用于连接数上限检查） */
  maxConnections: number;
}

/**
 * 处理新的 WebSocket 连接
 *
 * @param socket Fastify WebSocket（兼容 ws 接口）
 * @param deps 处理器依赖
 */
export function handleConnection(socket: WebSocket, deps: WebSocketHandlerDeps): void {
  const { store, messenger, emitter, maxConnections } = deps;

  // 连接数上限检查
  if (store.size >= maxConnections) {
    log.warn({ current: store.size, max: maxConnections }, '连接数已达上限，拒绝新连接');
    socket.close(1_013, 'Too many connections');
    return;
  }

  const connectionId = randomUUID();
  store.add(connectionId, socket, { channelId: 'web', userId: 'pending' });

  log.info({ connectionId }, '新 WebSocket 连接');
  emitter.emit('connection', connectionId);

  // 消息事件
  socket.on('message', (rawData: Buffer | string) => {
    const data = typeof rawData === 'string' ? rawData : rawData.toString();

    // 检查背压 —— 忽略过大消息
    if (data.length > deps.maxMessageSize) {
      messenger.send(connectionId, {
        type: 'response',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        requestId: '__oversize',
        status: 'error',
        payload: {},
        errorCode: 'MESSAGE_TOO_LARGE',
        errorMessage: `消息体过大，最大 ${deps.maxMessageSize / 1024}KB`,
      } as ResponseMessage);
      return;
    }

    handleMessage(connectionId, data, deps);
  });

  // 关闭事件
  socket.on('close', (code: number, reason: Buffer) => {
    store.delete(connectionId);
    log.info({ connectionId, code, reason: reason.toString() }, 'WebSocket 连接已关闭');
    emitter.emit('disconnection', connectionId, code, reason.toString());
  });

  // 错误事件
  socket.on('error', (err: Error) => {
    log.error({ connectionId, error: err.message }, 'WebSocket 连接错误');
    emitter.emit('error', connectionId, err);
  });
}

/**
 * 处理客户端消息 —— 与旧版完全兼容
 *
 * @param connectionId 连接唯一标识
 * @param rawData 原始文本消息
 * @param deps 处理器依赖
 */
function handleMessage(connectionId: string, rawData: string, deps: WebSocketHandlerDeps): void {
  const { store, router, messenger, emitter } = deps;

  let parsed: GatewayMessage;

  try {
    parsed = JSON.parse(rawData) as GatewayMessage;
  } catch (err) {
    log.warn({ connectionId, error: (err as Error).message }, '消息 JSON 解析失败');
    messenger.send(connectionId, {
      type: 'response',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      requestId: '__parse_error',
      status: 'error',
      payload: {},
      errorCode: 'PARSE_ERROR',
      errorMessage: '无法解析消息体',
    } as ResponseMessage);
    return;
  }

  log.debug({ connectionId, type: parsed.type, id: parsed.id }, '收到消息');

  if (parsed.type === 'request') {
    const reqMsg = parsed as RequestMessage;

    // 记录渠道绑定
    const channelId = (reqMsg.payload.channelId as string) ?? 'default';
    const userId = (reqMsg.payload.userId as string) ?? 'anonymous';
    store.setMetadata(connectionId, { channelId, userId });

    emitter.emit('message', connectionId, reqMsg);

    // 使用 Promise.resolve 包裹，确保同步异常也能被 .catch 捕获
    try {
      router
        .route({
          messageId: reqMsg.id,
          channelId,
          userId,
          userName: reqMsg.payload.userName as string | undefined,
          content: (reqMsg.payload.content as string) ?? '',
          messageType: (reqMsg.payload.messageType as NormalizedMessage['messageType']) ?? 'text',
          attachments: reqMsg.payload.attachments as NormalizedMessage['attachments'],
          raw: reqMsg.payload,
          timestamp: new Date(reqMsg.timestamp).getTime(),
        })
        .then((result) => {
          const response: ResponseMessage = {
            type: 'response',
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            requestId: reqMsg.id,
            status: result.matched ? 'success' : 'error',
            payload: {
              matched: result.matched,
              agentId: result.agentId ?? null,
              sessionId: result.session?.sessionId ?? null,
              reason: result.reason ?? null,
            },
            ...(!result.matched && {
              errorCode: 'NO_MATCH',
              errorMessage: result.reason,
            }),
          };
          messenger.send(connectionId, response);
        })
        .catch((err: Error) => {
          log.error({ connectionId, error: err.message }, '路由处理失败');
          messenger.send(connectionId, {
            type: 'response',
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            requestId: reqMsg.id,
            status: 'error',
            payload: {},
            errorCode: 'ROUTE_ERROR',
            errorMessage: err.message,
          } as ResponseMessage);
        });
    } catch (syncErr) {
      // 捕获 router.route() 的同步异常（如参数校验失败）
      log.error({ connectionId, error: (syncErr as Error).message }, '路由同步异常');
      messenger.send(connectionId, {
        type: 'response',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        requestId: reqMsg.id,
        status: 'error',
        payload: {},
        errorCode: 'ROUTE_ERROR',
        errorMessage: (syncErr as Error).message,
      } as ResponseMessage);
    }

    return;
  }

  emitter.emit('message', connectionId, parsed);
}
