import { randomUUID } from 'node:crypto';
import type { CLIWebSocketClient } from './websocket.js';
import { WebSocketEvent } from './websocket.js';
import type { AttachmentInfo, ChatDeltaPayload, ChatDonePayload, ResponseMessage } from './types.js';
import { SHARED_USER_ID } from '../config/sync-defaults.js';

export interface ChatExchangeOptions {
  sessionId: string;
  content: string;
  model: string;
  channelId: string;
  stream: boolean;
  attachments?: AttachmentInfo[];
  timeoutMs?: number;
}

export interface ChatExchangeResult {
  requestId: string;
  responsePayload?: Record<string, unknown>;
  done?: ChatDonePayload;
  deltas: ChatDeltaPayload[];
  reasoningDeltas: ChatDeltaPayload[];
}

export async function runChatExchange(
  ws: CLIWebSocketClient,
  options: ChatExchangeOptions,
): Promise<ChatExchangeResult> {
  const requestId = randomUUID();
  const timeoutMs = options.timeoutMs ?? 120000;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutHandle: ReturnType<typeof setTimeout> | undefined = undefined;
    let responsePayload: Record<string, unknown> | undefined;
    let resolvedSessionId = options.sessionId;
    const deltas: ChatDeltaPayload[] = [];
    const reasoningDeltas: ChatDeltaPayload[] = [];

    const isCurrentSession = (payload?: { sessionId?: string }): boolean => {
      if (!payload?.sessionId) return true;
      return payload.sessionId === options.sessionId || payload.sessionId === resolvedSessionId;
    };

    const cleanup = () => {
      ws.off(WebSocketEvent.RESPONSE, onResponse);
      ws.off(WebSocketEvent.CHAT_DELTA, onDelta);
      ws.off(WebSocketEvent.CHAT_REASONING_DELTA, onReasoningDelta);
      ws.off(WebSocketEvent.CHAT_DONE, onDone);
      ws.off(WebSocketEvent.CHAT_ERROR, onChatError);
      ws.off(WebSocketEvent.ERROR, onSocketError);
    };

    const finish = (result: ChatExchangeResult) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      cleanup();
      resolve(result);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      cleanup();
      reject(error);
    };

    const onResponse = (message: ResponseMessage) => {
      if (message.requestId !== requestId) return;

      if (message.status === 'error') {
        fail(new Error(message.errorMessage || message.errorCode || 'Gateway request failed'));
        return;
      }

      responsePayload = message.payload;
      const payloadSessionId = typeof message.payload?.sessionId === 'string'
        ? message.payload.sessionId
        : undefined;
      if (payloadSessionId) {
        resolvedSessionId = payloadSessionId;
      }

      const matched = message.payload?.matched;
      if (matched === false) {
        fail(new Error(String(message.payload?.reason || 'No routing rule matched')));
        return;
      }

      if (!options.stream && message.payload && 'content' in message.payload) {
        finish({ requestId, responsePayload, deltas, reasoningDeltas });
      }
    };

    const onDelta = (payload: ChatDeltaPayload) => {
      if (!isCurrentSession(payload)) return;
      deltas.push(payload);
    };

    const onReasoningDelta = (payload: ChatDeltaPayload) => {
      if (!isCurrentSession(payload)) return;
      reasoningDeltas.push(payload);
    };

    const onDone = (payload: ChatDonePayload & { requestId?: string }) => {
      if (payload.requestId && payload.requestId !== requestId) return;
      if (!isCurrentSession(payload)) return;
      finish({ requestId, responsePayload, done: payload, deltas, reasoningDeltas });
    };

    const onChatError = (payload: { sessionId?: string; message?: string; requestId?: string }) => {
      if (payload.requestId && payload.requestId !== requestId) return;
      if (!isCurrentSession(payload)) return;
      fail(new Error(payload.message || 'Agent reply failed'));
    };

    const onSocketError = (error: Error) => {
      fail(error);
    };

    ws.on(WebSocketEvent.RESPONSE, onResponse);
    ws.on(WebSocketEvent.CHAT_DELTA, onDelta);
    ws.on(WebSocketEvent.CHAT_REASONING_DELTA, onReasoningDelta);
    ws.on(WebSocketEvent.CHAT_DONE, onDone);
    ws.on(WebSocketEvent.CHAT_ERROR, onChatError);
    ws.on(WebSocketEvent.ERROR, onSocketError);

    void ws.bindSession(options.sessionId, {
      channelId: options.channelId,
      userId: SHARED_USER_ID,
    }).then(() => {
      try {
        ws.send({
          type: 'request',
          id: requestId,
          timestamp: new Date().toISOString(),
          action: 'chat.send',
          payload: {
            sessionId: options.sessionId,
            content: options.content,
            model: options.model,
            channelId: options.channelId,
            stream: options.stream,
            userId: SHARED_USER_ID,
            attachments: options.attachments,
          },
        });
      } catch (sendError) {
        fail(sendError instanceof Error ? sendError : new Error(String(sendError)));
      }
    }).catch((error: Error) => {
      fail(error);
    });

    timeoutHandle = setTimeout(() => {
      fail(new Error(`Chat exchange timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}
