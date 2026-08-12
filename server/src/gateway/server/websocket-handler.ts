import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { EventEmitter } from 'node:events';
import { createLogger } from '../../core/utils/logger.js';
import type { MessageRouter } from '../routing/index.js';
import type { SecuritySandbox } from '../security/index.js';
import type { TokenService } from '../security/token-service.js';
import type { ConnectionStore } from './connection-store.js';
import type { Messenger } from './messaging.js';
import type { GatewayMessage, RequestMessage, ResponseMessage } from '../protocol.js';
import type { NormalizedMessage } from '../sessions/types.js';
import type { AgentBridge } from '../agent-bridge.js';
import type { SessionManager } from '../sessions/index.js';
import { resolveRealtimeShortcut } from './realtime-shortcuts.js';

const log = createLogger('gateway:websocket-handler');

export interface WebSocketHandlerDeps {
  store: ConnectionStore;
  router: MessageRouter;
  sessions: SessionManager;
  maxMessageSize: number;
  emitter: EventEmitter;
  messenger: Messenger;
  maxConnections: number;
  sandbox?: SecuritySandbox;
  tokenService?: TokenService;
  audit?: unknown;
  stateManager?: unknown;
  scheduler?: unknown;
  agentBridge?: AgentBridge;
}

function extractWsToken(socket: WebSocket): string | undefined {
  const withSocket = socket as unknown as { _socket?: { _httpMessage?: { url?: string } } };
  const url = withSocket._socket?._httpMessage?.url;
  if (!url) {
    return undefined;
  }

  try {
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) {
      return undefined;
    }

    const queryStr = url.slice(queryIndex + 1);
    const params = new URLSearchParams(queryStr);
    return params.get('token') ?? undefined;
  } catch {
    return undefined;
  }
}

export function handleConnection(socket: WebSocket, deps: WebSocketHandlerDeps): void {
  const { store, messenger, emitter, maxConnections, sandbox, tokenService } = deps;

  if (store.size >= maxConnections) {
    log.warn({ current: store.size, max: maxConnections }, 'Connection limit reached, rejecting new socket');
    socket.close(1013, 'Too many connections');
    return;
  }

  let confirmedUserId = 'pending';
  if (sandbox) {
    const token = extractWsToken(socket);
    const authResult = sandbox.authenticate(token);

    if (authResult.passed && token && tokenService) {
      try {
        const payload = tokenService.verify(token);
        confirmedUserId = payload.sub;
      } catch {
        confirmedUserId = 'pending';
      }
    } else if (!authResult.passed) {
      log.warn('WebSocket authentication failed, rejecting connection');
      socket.close(4001, 'Unauthorized');
      return;
    }
  }

  const connectionId = randomUUID();
  store.add(connectionId, socket, { channelId: 'web', userId: confirmedUserId });
  emitter.emit('connection', connectionId);

  socket.on('message', (rawData: Buffer | string) => {
    const data = typeof rawData === 'string' ? rawData : rawData.toString();

    if (data.length > deps.maxMessageSize) {
      messenger.send(connectionId, {
        type: 'response',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        requestId: '__oversize',
        status: 'error',
        payload: {},
        errorCode: 'MESSAGE_TOO_LARGE',
        errorMessage: `Message exceeds limit of ${deps.maxMessageSize / 1024}KB`,
      } as ResponseMessage);
      return;
    }

    handleMessage(connectionId, data, deps);
  });

  socket.on('close', (code: number, reason: Buffer) => {
    store.delete(connectionId);
    emitter.emit('disconnection', connectionId, code, reason.toString());
  });

  socket.on('error', (err: Error) => {
    log.error({ connectionId, error: err.message }, 'WebSocket connection error');
    emitter.emit('error', connectionId, err);
  });
}

function handleMessage(connectionId: string, rawData: string, deps: WebSocketHandlerDeps): void {
  const { store, router, messenger, emitter } = deps;

  let parsed: GatewayMessage;
  try {
    parsed = JSON.parse(rawData) as GatewayMessage;
  } catch (err) {
    messenger.send(connectionId, {
      type: 'response',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      requestId: '__parse_error',
      status: 'error',
      payload: {},
      errorCode: 'PARSE_ERROR',
      errorMessage: `Unable to parse message body: ${(err as Error).message}`,
    } as ResponseMessage);
    return;
  }

  // 调试日志：记录所有非 session.bind 的消息（排查 chat.send 丢失问题）
  if (parsed.type === 'request' && parsed.action !== 'session.bind') {
    log.debug({
      connectionId,
      action: parsed.action,
    }, 'WebSocket request received');
  }

  if (parsed.type === 'ping') {
    messenger.send(connectionId, {
      type: 'pong',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (parsed.type !== 'request') {
    emitter.emit('message', connectionId, parsed);
    return;
  }

  const reqMsg = parsed as RequestMessage;
  const channelId = String(reqMsg.payload.channelId ?? 'default');
  const userId = String(reqMsg.payload.userId ?? 'anonymous');
  const sessionId = typeof reqMsg.payload.sessionId === 'string' ? reqMsg.payload.sessionId : undefined;
  const currentMeta = store.getMetadata(connectionId);
  store.setMetadata(connectionId, {
    channelId,
    userId,
    sessionId: sessionId ?? currentMeta?.sessionId,
  });

  // 调试日志：记录连接的 channelId/userId 绑定情况
  if (reqMsg.action === 'session.bind' || reqMsg.action === 'chat.send') {
    const meta = store.getMetadata(connectionId);
    const totalConnections = store.size;
    const myChannelConnections = store.getConnectionIdsByChannel(channelId);
    log.info({
      connectionId,
      action: reqMsg.action,
      channelId,
      userId,
      sessionId: meta?.sessionId,
      totalConnections,
      connectionsInChannel: myChannelConnections.length,
    }, 'Connection channel/user binding');
  }

  emitter.emit('message', connectionId, reqMsg);

  if (reqMsg.action === 'session.bind') {
    messenger.send(connectionId, {
      type: 'response',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      requestId: reqMsg.requestId ?? reqMsg.id,
      status: 'success',
      payload: {
        sessionId: sessionId ?? null,
        bound: !!sessionId,
      },
    } as ResponseMessage);
    return;
  }

  if (reqMsg.action === 'chat.history') {
    const { sessionId, offset = 0, limit = 20 } = reqMsg.payload as {
      sessionId: string;
      offset?: number;
      limit?: number;
    };

    try {
      const result = deps.sessions.getHistoryPaginated(sessionId, { offset, limit });
      messenger.send(connectionId, {
        type: 'response',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        requestId: reqMsg.requestId ?? reqMsg.id,
        status: 'success',
        payload: {
          sessionId,
          messages: result.messages.map((message) => ({
            messageId: message.messageId,
            role: resolveHistoryRole(message),
            content: message.content,
            timestamp: message.timestamp,
          })),
          hasMore: result.hasMore,
          total: result.total,
          offset,
          limit,
        },
      } as ResponseMessage);
    } catch (err) {
      messenger.send(connectionId, {
        type: 'response',
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        requestId: reqMsg.requestId ?? reqMsg.id,
        status: 'error',
        payload: {},
        errorCode: 'HISTORY_ERROR',
        errorMessage: (err as Error).message,
      } as ResponseMessage);
    }
    return;
  }

  void router.route({
    messageId: reqMsg.id,
    sessionId: typeof reqMsg.payload.sessionId === 'string' ? reqMsg.payload.sessionId : undefined,
    channelId,
    userId,
    userName: reqMsg.payload.userName as string | undefined,
    content: String(reqMsg.payload.content ?? ''),
    messageType: (reqMsg.payload.messageType as NormalizedMessage['messageType']) ?? 'text',
    attachments: reqMsg.payload.attachments as NormalizedMessage['attachments'],
    raw: reqMsg.payload,
    timestamp: new Date(reqMsg.timestamp).getTime(),
  }).then((result) => {
    const response: ResponseMessage = {
      type: 'response',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      requestId: reqMsg.requestId ?? reqMsg.id,
      status: result.matched ? 'success' : 'error',
      payload: {
        matched: result.matched,
        agentId: result.agentId ?? null,
        sessionId: result.session?.sessionId ?? null,
        reason: result.reason ?? null,
      },
      ...(!result.matched
        ? {
            errorCode: 'NO_MATCH',
            errorMessage: result.reason,
          }
        : {}),
    };

    messenger.send(connectionId, response);

    // 广播用户消息到同渠道的所有连接，确保跨端消息同步
    if (result.matched && result.session) {
      const sessionIdForReply = result.session.sessionId;
      const userMessageEvent = {
        type: 'event' as const,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        event: 'chat.message_sent',
        payload: {
          sessionId: sessionIdForReply,
          channelId,
          userId,
          content: String(reqMsg.payload.content ?? ''),
          messageType: reqMsg.payload.messageType ?? 'text',
          role: 'user',
          source: 'cross-client',
        },
      };
      // 先广播给 session 中的连接
      messenger.broadcastToSession(sessionIdForReply, userMessageEvent);
      // 获取 session 中的连接 ID，在广播给 channel 时排除它们，避免重复发送
      const sessionConnectionIds = new Set(deps.store.getConnectionIdsBySession(sessionIdForReply));
      messenger.broadcastToChannel(channelId, userMessageEvent, sessionConnectionIds);
    }

    if (result.matched && result.session && deps.agentBridge) {
      const sessionIdForReply = result.session.sessionId;
      const content = String(reqMsg.payload.content ?? '');

      void resolveRealtimeShortcut({
        content,
        sessionId: sessionIdForReply,
        channelId,
        userId,
      }).then((shortcut) => {
        if (shortcut) {
          emitDirectReply(
            messenger,
            deps.store,
            sessionIdForReply,
            channelId,
            shortcut.reply,
            shortcut.reasoning,
          );
          return;
        }

        void emitAgentReply(
          deps.agentBridge!,
          messenger,
          deps.store,
          sessionIdForReply,
          result.agentId ?? 'default',
          content,
          channelId,
          userId,
          reqMsg.requestId ?? reqMsg.id,
        );
      }).catch(() => {
        void emitAgentReply(
          deps.agentBridge!,
          messenger,
          deps.store,
          sessionIdForReply,
          result.agentId ?? 'default',
          content,
          channelId,
          userId,
          reqMsg.requestId ?? reqMsg.id,
        );
      });
      return;
    }

    if (result.matched && result.session) {
      emitMockStream(messenger, deps.store, result.session.sessionId, channelId, String(reqMsg.payload.content ?? ''));
    }
  }).catch((err: Error) => {
    messenger.send(connectionId, {
      type: 'response',
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      requestId: reqMsg.requestId ?? reqMsg.id,
      status: 'error',
      payload: {},
      errorCode: 'ROUTE_ERROR',
      errorMessage: err.message,
    } as ResponseMessage);
  });
}

function resolveHistoryRole(message: NormalizedMessage): 'user' | 'assistant' | 'system' {
  const direct = inferHistoryRole(message.raw);
  if (direct) {
    return direct;
  }

  const content = message.content.trim();
  if (!content) {
    return 'assistant';
  }

  return 'user';
}

function inferHistoryRole(raw: unknown): 'user' | 'assistant' | 'system' | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const role = candidate.role;
  if (role === 'user' || role === 'assistant' || role === 'system') {
    return role;
  }

  const source = candidate.source;
  if (source === 'user' || source === 'assistant' || source === 'system') {
    return source;
  }

  return null;
}

async function emitAgentReply(
  agentBridge: AgentBridge,
  messenger: Messenger,
  store: ConnectionStore,
  sessionId: string,
  agentId: string,
  userMessage: string,
  channelId: string,
  userId: string,
  requestId: string,
): Promise<void> {
  const messageId = `agent-${randomUUID()}`;

  try {
    const result = await agentBridge.invoke({
      agentId,
      message: userMessage,
      channelId,
      userId,
      sessionId,
      taskId: requestId,
    });

    const reply = normalizeFinalAnswer(result.response);
    const reasoning = result.reasoningContent ?? '';
    const sessionConnectionIds = new Set(store.getConnectionIdsBySession(sessionId));

    log.info({
      sessionId,
      channelId,
      userId,
      agentId,
      requestId,
      replyLength: reply.length,
      reasoningLength: reasoning.length,
      sessionConnectionCount: sessionConnectionIds.size,
      channelConnectionCount: store.getConnectionIdsByChannel(channelId).length,
    }, 'Agent reply ready for websocket broadcast');

    if (reasoning) {
      const reasoningEvent = {
        type: 'event' as const,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        event: 'chat.reasoning_delta',
        payload: {
          sessionId,
          delta: reasoning,
          accumulated: reasoning,
        },
      };
      // 同时广播给 session 和 channel，排除已在 session 中的连接
      messenger.broadcastToSession(sessionId, reasoningEvent);
      messenger.broadcastToChannel(channelId, reasoningEvent, sessionConnectionIds);
      log.info({
        sessionId,
        channelId,
        reasoningLength: reasoning.length,
      }, 'Broadcasted chat.reasoning_delta');
    }

    let cursor = 0;
    const pushChunk = (): void => {
      if (cursor >= reply.length) {
        const doneEvent = {
          type: 'event' as const,
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          event: 'chat.done',
          payload: {
            sessionId,
            messageId,
            totalContent: reply,
            totalReasoning: reasoning || undefined,
            reasoningDurationMs: result.reasoningDurationMs,
            durationMs: result.duration,
          },
        };
        // 同时广播给 session 和 channel，排除已在 session 中的连接
        messenger.broadcastToSession(sessionId, doneEvent);
        messenger.broadcastToChannel(channelId, doneEvent, sessionConnectionIds);
        log.info({
          sessionId,
          channelId,
          totalLength: reply.length,
        }, 'Broadcasted chat.done');
        return;
      }

      const chunkSize = Math.max(1, Math.min(8, Math.ceil(reply.length / 24)));
      const delta = reply.slice(cursor, cursor + chunkSize);
      cursor = Math.min(reply.length, cursor + chunkSize);
      const deltaEvent = {
        type: 'event' as const,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        event: 'chat.delta',
        payload: {
          sessionId,
          delta,
          accumulated: reply.slice(0, cursor),
        },
      };
      // 同时广播给 session 和 channel，排除已在 session 中的连接
      messenger.broadcastToSession(sessionId, deltaEvent);
      messenger.broadcastToChannel(channelId, deltaEvent, sessionConnectionIds);
      log.debug({
        sessionId,
        channelId,
        cursor,
        totalLength: reply.length,
      }, 'Broadcasted chat.delta');
      setTimeout(pushChunk, 15);
    };

    setTimeout(pushChunk, 10);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error(
      {
        sessionId,
        agentId,
        requestId,
        error: error.message,
      },
      'Agent reply failed',
    );

    log.info({
      sessionId,
      channelId,
      sessionConnectionCount: store.getConnectionIdsBySession(sessionId).length,
      channelConnectionCount: store.getConnectionIdsByChannel(channelId).length,
    }, 'Preparing chat.error broadcast');

    const errorEvent = {
      type: 'event' as const,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      event: 'chat.error',
      payload: {
        sessionId,
        messageId,
        code: 'AGENT_ERROR',
        message: toUserFacingAgentError(error),
      },
    };
    // 同时广播给 session 和 channel，排除已在 session 中的连接
    const sessionConnectionIds = new Set(store.getConnectionIdsBySession(sessionId));
    messenger.broadcastToSession(sessionId, errorEvent);
    messenger.broadcastToChannel(channelId, errorEvent, sessionConnectionIds);
  }
}

function emitDirectReply(
  messenger: Messenger,
  store: ConnectionStore,
  sessionId: string,
  channelId: string,
  replyText: string,
  reasoning?: string,
): void {
  const messageId = `shortcut-${randomUUID()}`;
  const reply = normalizeFinalAnswer(replyText);
  // 获取 session 中的连接 ID，在广播给 channel 时排除它们
  const sessionConnectionIds = new Set(store.getConnectionIdsBySession(sessionId));

  if (reasoning?.trim()) {
    const reasoningEvent = {
      type: 'event' as const,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      event: 'chat.reasoning_delta',
      payload: {
        sessionId,
        delta: reasoning,
        accumulated: reasoning,
      },
    };
    // 同时广播给 session 和 channel，排除已在 session 中的连接
    messenger.broadcastToSession(sessionId, reasoningEvent);
    messenger.broadcastToChannel(channelId, reasoningEvent, sessionConnectionIds);
  }

  let cursor = 0;
  const pushChunk = (): void => {
    if (cursor >= reply.length) {
      const doneEvent = {
        type: 'event' as const,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        event: 'chat.done',
        payload: {
          sessionId,
          messageId,
          totalContent: reply,
          totalReasoning: reasoning || undefined,
          reasoningDurationMs: reasoning ? 1 : undefined,
          durationMs: 1,
        },
      };
      // 同时广播给 session 和 channel，排除已在 session 中的连接
      messenger.broadcastToSession(sessionId, doneEvent);
      messenger.broadcastToChannel(channelId, doneEvent, sessionConnectionIds);
      return;
    }

    const chunkSize = Math.max(1, Math.min(8, Math.ceil(reply.length / 18)));
    const delta = reply.slice(cursor, cursor + chunkSize);
    cursor = Math.min(reply.length, cursor + chunkSize);
    const deltaEvent = {
      type: 'event' as const,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      event: 'chat.delta',
      payload: {
        sessionId,
        delta,
        accumulated: reply.slice(0, cursor),
      },
    };
    // 同时广播给 session 和 channel，排除已在 session 中的连接
    messenger.broadcastToSession(sessionId, deltaEvent);
    messenger.broadcastToChannel(channelId, deltaEvent, sessionConnectionIds);
    setTimeout(pushChunk, 12);
  };

  setTimeout(pushChunk, 8);
}

function normalizeFinalAnswer(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return text;
  }

  const finalMatch = trimmed.match(/<final_answer>([\s\S]*?)<\/final_answer>/i);
  if (finalMatch) {
    return finalMatch[1].trim();
  }

  return trimmed
    .replace(/^<final_answer>\s*/i, '')
    .replace(/\s*<\/final_answer>$/i, '')
    .trim();
}

function toUserFacingAgentError(err: Error): string {
  const message = err.message.toLowerCase();
  if (message.includes('timeout') || message.includes('timed out') || message.includes('deadline')) {
    return '当前请求处理超时，请稍后重试，或换一个更短的问题。';
  }

  return '当前请求处理失败，请稍后重试。';
}

function emitMockStream(
  messenger: Messenger,
  store: ConnectionStore,
  sessionId: string,
  channelId: string,
  userMessage: string,
): void {
  const reply = generateMockReply(userMessage);
  const reasoning = generateMockReasoning(userMessage);
  const messageId = `mock-${randomUUID()}`;
  const reasoningStartedAt = Date.now();
  // 获取 session 中的连接 ID，在广播给 channel 时排除它们
  const sessionConnectionIds = new Set(store.getConnectionIdsBySession(sessionId));

  if (reasoning.length > 0) {
    const reasoningEvent = {
      type: 'event' as const,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      event: 'chat.reasoning_delta',
      payload: {
        sessionId,
        delta: reasoning,
        accumulated: reasoning,
      },
    };
    // 同时广播给 session 和 channel，排除已在 session 中的连接
    messenger.broadcastToSession(sessionId, reasoningEvent);
    messenger.broadcastToChannel(channelId, reasoningEvent, sessionConnectionIds);
  }

  let cursor = 0;
  const tick = (): void => {
    if (cursor >= reply.length) {
      const doneEvent = {
        type: 'event' as const,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        event: 'chat.done',
        payload: {
          sessionId,
          messageId,
          totalContent: reply,
          totalReasoning: reasoning || undefined,
          reasoningDurationMs: reasoning ? Date.now() - reasoningStartedAt : undefined,
          durationMs: reply.length * 60,
        },
      };
      // 同时广播给 session 和 channel，排除已在 session 中的连接
      messenger.broadcastToSession(sessionId, doneEvent);
      messenger.broadcastToChannel(channelId, doneEvent, sessionConnectionIds);
      return;
    }

    const chunkSize = 1 + Math.floor(Math.random() * 3);
    const delta = reply.slice(cursor, cursor + chunkSize);
    cursor = Math.min(reply.length, cursor + chunkSize);
    const deltaEvent = {
      type: 'event' as const,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      event: 'chat.delta',
      payload: {
        sessionId,
        delta,
        accumulated: reply.slice(0, cursor),
      },
    };
    // 同时广播给 session 和 channel，排除已在 session 中的连接
    messenger.broadcastToSession(sessionId, deltaEvent);
    messenger.broadcastToChannel(channelId, deltaEvent, sessionConnectionIds);
    setTimeout(tick, 40);
  };

  setTimeout(tick, 60);
}

function generateMockReply(userMessage: string): string {
  const msg = userMessage.trim();
  if (!msg) return 'Hello, I am the MyOpenClaw mock assistant.';
  if (msg.includes('你好') || msg.toLowerCase().includes('hi') || msg.toLowerCase() === 'hello') {
    return '你好，我是 MyOpenClaw 助手。当前正在通过 gateway 工作；如果尚未接入真实 Agent，将退回到 mock 回复。';
  }
  if (msg.includes('你是谁') || msg.toLowerCase().includes('who')) {
    return '我是 MyOpenClaw，一个支持多通道接入的 AI Agent Gateway。';
  }
  if (msg.includes('技术栈') || msg.toLowerCase().includes('stack')) {
    return 'MyOpenClaw 当前技术栈包括 Node.js、TypeScript、Fastify、Textual/Web 客户端，以及 WebSocket 通信。';
  }
  return `你说的是：“${msg}”\n\n这是当前的 mock 回复。Gateway 已经连通，真实 Agent 和 LLM 的接入正在继续完善。`;
}

function generateMockReasoning(userMessage: string): string {
  const msg = userMessage.trim().slice(0, 30) || '(空消息)';
  return [
    `用户输入: "${msg}"`,
    '',
    '先判断这是问候、身份问题、技术问题，还是普通闲聊。',
    '如果是问候，就返回简短友好的欢迎语。',
    '如果是身份或能力介绍，就说明 MyOpenClaw 的定位。',
    '如果是技术相关，就给出系统组成和当前状态。',
    '如果都不是，就先复述用户输入，再说明当前仍可能处于 mock 流程。',
  ].join('\n');
}
