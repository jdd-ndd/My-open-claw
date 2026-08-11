/**
 * 鑱婂ぉ鐘舵€佺鐞?Hook
 *
 * 娴佺▼:
 * 1. 鐢ㄦ埛鍦?InputBox 鎸夊洖杞?鈫?sendMessage(content)
 * 2. sendMessage 绔嬪嵆鎶?user 娑堟伅鍔犺繘 messages,骞跺惎鍔ㄤ竴涓?activeStream
 * 3. 閫氳繃 ws.request('chat.send', payload) 鍙戝埌 server
 *    - server response 鎼哄甫 matched/sessionId(鐢ㄤ簬缁戝畾娴?
 * 4. ws.onEvent 鎺ユ敹娴佸紡 event:
 *    - 'chat.delta': 鎷兼帴鍒?activeStream.content
 *    - 'chat.done' : 钀藉畾 final message,娓呯┖ activeStream
 *    - 'chat.error': 鍐欏叆閿欒娑堟伅,娓呯┖ activeStream
 *
 * 鍘嗗彶娑堟伅鍔犺浇:
 * - loadHistory(offset, limit): 鍔犺浇鎸囧畾浣嶇疆鐨勫巻鍙叉秷鎭? * - loadMoreHistory(): 鍔犺浇鏇村鍘嗗彶娑堟伅(鍒嗛〉)
 * - resetHistoryState(): 閲嶇疆鍘嗗彶鍔犺浇鐘舵€? */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActiveStream, ChatMessage } from '../types/ui.js';
import {
  type ChatDeltaPayload,
  type ChatReasoningDeltaPayload,
  type ChatDonePayload,
  type ChatErrorPayload,
  type ChatSendPayload,
  type ChatHistoryPayload,
  type ChatHistoryResponsePayload,
  type EventMessage,
} from '../types/message.js';
import { formatNow } from '../utils/format.js';
import { SHARED_CHANNEL_ID, SHARED_USER_ID } from '../config/sync-defaults.js';

export interface UseChatDeps {
  /** 鍙戦€?request,闇€瑕佸閮?useWebSocket 娉ㄥ叆 */
  request: <T = unknown>(action: string, payload: Record<string, unknown>, timeoutMs?: number) => Promise<T>;
  /** 璁㈤槄浜嬩欢鍥炶皟 */
  onEvent?: (handler: (event: EventMessage) => void) => () => void;
  /** 榛樿 sessionId(鏃?server 鍒嗛厤鏃朵娇鐢? */
  defaultSessionId?: string;
  /** 榛樿 channelId / userId */
  channelId?: string;
  userId?: string;
  /** 鍐呭瓨涓繚鐣欑殑鏈€澶ф秷鎭暟;瓒呰繃鏃朵涪寮冩渶鏃╃殑,闃叉闀夸細璇?OOM */
  maxMessages?: number;
}

export interface UseChatResult {
  messages: ChatMessage[];
  activeStream: ActiveStream | null;
  /** 褰撳墠娴佸紡绱Н鍐呭(鐢ㄤ簬娑堟伅鍒楄〃鏈€鏈覆鏌? */
  streamingContent: string;
  /** 褰撳墠娴佸紡鎬濊€冨唴瀹?reasoning_content) */
  reasoningContent: string;
  /** 鎬濊€冭繃绋嬪紑濮嬫椂闂?鐢ㄤ簬绠?duration) */
  reasoningStartedAt: number | null;
  /** 鍙戦€佹秷鎭?鐢ㄦ埛鎸夊洖杞? */
  sendMessage: (content: string) => Promise<void>;
  /** 鍙栨秷褰撳墠鐢熸垚 */
  cancelStream: () => void;
  /** 娓呯┖鎵€鏈夋秷鎭?*/
  clear: () => void;
  /** 鏍囪閿欒 */
  lastError: string | null;
  /** 鈹€鈹€ 鍘嗗彶娑堟伅鐩稿叧 鈹€鈹€ */
  /** 鏄惁姝ｅ湪鍔犺浇鍘嗗彶娑堟伅 */
  loadingHistory: boolean;
  /** 鏄惁杩樻湁鏇村鍘嗗彶娑堟伅鍙姞杞?*/
  hasMoreHistory: boolean;
  /** 鍘嗗彶娑堟伅鎬绘暟 */
  totalHistoryCount: number;
  /** 宸插姞杞界殑鍘嗗彶娑堟伅鏁伴噺 */
  loadedHistoryCount: number;
  /** 鍔犺浇鍘嗗彶娑堟伅 */
  loadHistory: (offset?: number, limit?: number) => Promise<void>;
  /** 鍔犺浇鏇村鍘嗗彶娑堟伅(婊氬姩鍔犺浇) */
  loadMoreHistory: (limit?: number) => Promise<void>;
  /** 閲嶇疆鍘嗗彶鍔犺浇鐘舵€?*/
  resetHistoryState: () => void;
}

const SEED: ChatMessage[] = [];
const MAX_MESSAGES_DEFAULT = 500;

export function useChat(deps: UseChatDeps): UseChatResult {
  const {
    request,
    onEvent,
    defaultSessionId = 'session-local',
    channelId = SHARED_CHANNEL_ID,
    userId = SHARED_USER_ID,
    maxMessages = MAX_MESSAGES_DEFAULT,
  } = deps;

  // 娑堟伅鏁拌鍓?瓒呰繃 maxMessages 鏃朵涪寮冩渶鏃╃殑(淇濈暀鏈€杩?N 鏉?
  const trimMessages = useCallback(
    (next: ChatMessage[]): ChatMessage[] =>
      next.length <= maxMessages ? next : next.slice(next.length - maxMessages),
    [maxMessages],
  );

  const [messages, setMessages] = useState<ChatMessage[]>(SEED);
  const [activeStream, setActiveStream] = useState<ActiveStream | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [reasoningContent, setReasoningContent] = useState('');
  const [reasoningStartedAt, setReasoningStartedAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  // 鈹€鈹€ 鍘嗗彶娑堟伅鍔犺浇鐘舵€?澹版槑鍦?clear 涔嬪墠,閬垮厤 TDZ 椋庨櫓) 鈹€鈹€
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [totalHistoryCount, setTotalHistoryCount] = useState(0);
  const [loadedHistoryCount, setLoadedHistoryCount] = useState(0);

  // 鐢?ref 鎸佹湁鏈€鏂?state,閬垮厤浜嬩欢鍥炶皟闂寘杩囨湡
  const stateRef = useRef({ activeStream, defaultSessionId, messages });
  stateRef.current = { activeStream, defaultSessionId, messages };

  // 鈹€鈹€ 璁㈤槄 server event 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  // 浜嬩欢澶勭悊(瀵瑰簲 types/message.ts 鐨?ChatEventName):
  //   chat.delta            鈫?绱姞 streamingContent(answer)
  //   chat.reasoning_delta  鈫?绱姞 reasoningContent(鎺ㄧ悊杩囩▼),璁?reasoningStartedAt
  //   chat.done             鈫?钀藉畾 ChatMessage(reasoning 浼樺厛鐢?totalReasoning)
  //   chat.error            鈫?鍐欑郴缁熼敊璇秷鎭?  useEffect(() => {
    if (!onEvent) return;
    const off = onEvent((event) => {
      const { event: name, payload } = event;
      if (name === 'chat.delta') {
        const p = payload as unknown as ChatDeltaPayload;
        // 浼樺厛鐢?server 缁欑殑 accumulated,閬垮厤 O(n虏) 瀹㈡埛绔嫾鎺?        if (typeof p.accumulated === 'string') {
          setStreamingContent(p.accumulated);
        } else if (p.delta) {
          stateRef.current.activeStream &&
            setStreamingContent((prev) => prev + p.delta);
        }
      } else if (name === 'chat.reasoning_delta') {
        const p = payload as unknown as ChatReasoningDeltaPayload;
        // 棣栨潯 reasoning 浜嬩欢:璁颁笅寮€濮嬫椂闂?鐢ㄤ簬绠?reasoningDurationMs
        setReasoningStartedAt((prev) => prev ?? Date.now());
        if (typeof p.accumulated === 'string') {
          setReasoningContent(p.accumulated);
        } else if (p.delta) {
          setReasoningContent((prev) => prev + p.delta);
        }
      } else if (name === 'chat.done') {
        const p = payload as unknown as ChatDonePayload;
        // reasoning 浼樺厛鐢?server 缁欑殑 totalReasoning(鏉冨▉鍊?,
        // 鍏滃簳鐢ㄥ鎴风绱姞鐨?reasoningContent
        const finalReasoning = (p.totalReasoning ?? '').trim() || reasoningContent.trim();
        // duration 鍚屾牱浼樺厛鐢?server 缁欑殑 reasoningDurationMs(鏉冨▉,鍙兘鍖呭惈 prefix 绛夊鎴风鐪嬩笉瑙佺殑閮ㄥ垎),
        // 鍏滃簳鐢?client 绱姞鐨?(Date.now() - startedAt)
        const reasoningDuration =
          p.reasoningDurationMs ?? (reasoningStartedAt ? Date.now() - reasoningStartedAt : undefined);
        setMessages((prev) =>
          trimMessages([
            ...prev,
            {
              id: p.messageId,
              role: 'assistant',
              content: p.totalContent,
              time: formatNow(),
              reasoning: finalReasoning || undefined,
              reasoningDurationMs: finalReasoning ? reasoningDuration : undefined,
            },
          ]),
        );
        setStreamingContent('');
        setReasoningContent('');
        setReasoningStartedAt(null);
        setActiveStream(null);
      } else if (name === 'chat.error') {
        const p = payload as unknown as ChatErrorPayload;
        setLastError(`${p.code}: ${p.message}`);
        setMessages((prev) =>
          trimMessages([
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: 'system',
              content: `[error ${p.code}] ${p.message}`,
              time: formatNow(),
            },
          ]),
        );
        setStreamingContent('');
        setReasoningContent('');
        setReasoningStartedAt(null);
        setActiveStream(null);
      }
    });
    return off;
  }, [onEvent, trimMessages, reasoningContent, reasoningStartedAt]);

  useEffect(() => {
    void request('session.bind', {
      sessionId: defaultSessionId,
      channelId,
      userId,
    }).catch(() => undefined);
  }, [request, defaultSessionId, channelId, userId]);

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setLastError(null);

    const now = formatNow();
    const streamId = `stream-${Date.now()}`;
    const sessionId = stateRef.current.defaultSessionId;

    // 璋冭瘯鏃ュ織:姣忔 sendMessage 鍏ュ彛閮芥墦,鐪?client 绔槸鍚﹁澶氭璋冪敤
    // eslint-disable-next-line no-console
    console.error(`[DEBUG] sendMessage called: streamId=${streamId} content="${trimmed.slice(0, 30)}"`);

    // 1) 绔嬪嵆鎻掑叆 user 娑堟伅
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: 'user', content: trimmed, time: now },
    ]);
    // 2) 鍚姩娴佸崰浣?    setActiveStream({ id: streamId, prompt: trimmed, time: now });
    setStreamingContent('');

    // 3) 鍙?request 鍒?server
    const payload: ChatSendPayload = {
      sessionId,
      content: trimmed,
      channelId,
      userId,
      messageType: 'text',
    };
    try {
      const resp = await request<{ matched?: boolean; sessionId?: string; agentId?: string | null }>(
        'chat.send',
        payload as unknown as Record<string, unknown>,
        10_000,
      );
      // 4) 鐢?server 杩斿洖鐨?sessionId 鏇存柊(鑻?server 鍒嗛厤浜嗘柊 ID)
      if (resp?.sessionId && resp.sessionId !== sessionId) {
        setActiveStream((cur) => (cur ? { ...cur, id: streamId } : cur));
        // 娉ㄦ剰:杩欓噷涓嶆洿鏂?activeStream.sessionId 瀛楁(绫诲瀷鏃犳瀛楁),
        // sessionId 鍚庣画閫氳繃 event.payload.sessionId 娴佸叆
      }
      if (resp?.matched === false) {
        setMessages((prev) => [
          ...prev,
          {
            id: `sys-${Date.now()}`,
            role: 'system',
            content: '[no agent matched] 娌℃湁鍙敤瑙勫垯澶勭悊璇ユ秷鎭?,
            time: formatNow(),
          },
        ]);
        setActiveStream(null);
        setStreamingContent('');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'system',
          content: `[send failed] ${msg}`,
          time: formatNow(),
        },
      ]);
      setActiveStream(null);
      setStreamingContent('');
    }
  }, [request, channelId, userId]);

  const cancelStream = useCallback(() => {
    setActiveStream(null);
    setStreamingContent('');
    // 閫氱煡 server 鍙栨秷(鑻ユ敮鎸?
    try {
      request('chat.cancel', { sessionId: stateRef.current.defaultSessionId }, 3_000).catch(() => undefined);
    } catch { /* noop */ }
  }, [request]);

  const clear = useCallback(() => {
    setMessages([]);
    setActiveStream(null);
    setStreamingContent('');
    setReasoningContent('');
    setReasoningStartedAt(null);
    setLastError(null);
    // 閲嶇疆鍘嗗彶娑堟伅鐘舵€?    setLoadingHistory(false);
    setHasMoreHistory(false);
    setTotalHistoryCount(0);
    setLoadedHistoryCount(0);
  }, []);

  // 鈹€鈹€ 鍘嗗彶娑堟伅鍔犺浇鐘舵€?宸蹭笂绉?瑙?hook 椤堕儴) 鈹€鈹€

  /** 鍘嗗彶鍔犺浇鐘舵€佺殑 ref,閬垮厤闂寘杩囨湡 */
  const historyRef = useRef({
    loadingHistory: false,
    hasMoreHistory: false,
    loadedHistoryCount: 0,
  });
  historyRef.current = { loadingHistory, hasMoreHistory, loadedHistoryCount };

  /**
   * 鍔犺浇鍘嗗彶娑堟伅
   *
   * 浠庢寚瀹?offset 寮€濮嬪姞杞?limit 鏉″巻鍙叉秷鎭?
   * 鍔犺浇鐨勬秷鎭細鎻掑叆鍒扮幇鏈夋秷鎭垪琛ㄧ殑鍓嶉潰銆?   */
  const loadHistory = useCallback(async (offset = 0, limit = 20) => {
    if (historyRef.current.loadingHistory) return;

    setLoadingHistory(true);
    try {
      const sessionId = stateRef.current.defaultSessionId;
      const payload: ChatHistoryPayload = {
        sessionId,
        offset,
        limit,
      };

      const result = await request<ChatHistoryResponsePayload>(
        'chat.history',
        payload as unknown as Record<string, unknown>,
        5_000,
      );

      if (result && result.messages) {
        // 灏嗗巻鍙叉秷鎭浆鎹负 ChatMessage 鏍煎紡
        const historyMessages: ChatMessage[] = result.messages.map((m) => ({
          id: m.messageId,
          role: m.role,
          content: m.content,
          time: formatNow(),
        }));

        // 鎻掑叆鍒扮幇鏈夋秷鎭垪琛ㄧ殑鍓嶉潰锛堝巻鍙叉秷鎭湪鍓嶉潰,鏂版秷鎭湪鍚庨潰锛?        setMessages((prev) => [...historyMessages, ...prev]);
        setHasMoreHistory(result.hasMore);
        setTotalHistoryCount(result.total);
        setLoadedHistoryCount(offset + historyMessages.length);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(`鍘嗗彶鍔犺浇澶辫触:${msg}`);
    } finally {
      setLoadingHistory(false);
    }
  }, [request]);

  /**
   * 鍔犺浇鏇村鍘嗗彶娑堟伅锛堢敤浜庢粴鍔ㄥ姞杞斤級
   *
   * 鑷姩浠庡凡鍔犺浇鐨勪綅缃户缁姞杞戒笅涓€鎵瑰巻鍙叉秷鎭€?   */
  const loadMoreHistory = useCallback(async (limit = 20) => {
    if (historyRef.current.loadingHistory || !historyRef.current.hasMoreHistory) return;
    await loadHistory(historyRef.current.loadedHistoryCount, limit);
  }, [loadHistory]);

  /**
   * 閲嶇疆鍘嗗彶鍔犺浇鐘舵€?   */
  const resetHistoryState = useCallback(() => {
    setLoadingHistory(false);
    setHasMoreHistory(false);
    setTotalHistoryCount(0);
    setLoadedHistoryCount(0);
  }, []);

  return {
    messages,
    activeStream,
    streamingContent,
    reasoningContent,
    reasoningStartedAt,
    sendMessage,
    cancelStream,
    clear,
    lastError,
    // 鍘嗗彶娑堟伅鐩稿叧
    loadingHistory,
    hasMoreHistory,
    totalHistoryCount,
    loadedHistoryCount,
    loadHistory,
    loadMoreHistory,
    resetHistoryState,
  };
}


