import { useEffect, useCallback, useRef } from 'react';
import { useChatStore } from '@/stores/useChatStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { wsClient } from '@/api/gateway';
import { fetchChatHistory } from '@/api/history';
import { fetchChannelMessages, replyToChannelUser, type ChannelMessage } from '@/api/channels';
import type { ChatMessage } from '@/types/message';
import type { ChatDeltaEvent, ChatDoneEvent } from '@/api/types';
import type { GatewayMessage } from '@/types/gateway';
import { fileToGatewayAttachment, type GatewayAttachment } from '@/types/attachment';
import { SHARED_CHANNEL_ID, SHARED_USER_ID, isMonitorSession, getMonitorSessionConfig, getMonitorSessionByChannel } from '@/config/sync-defaults';

const DEFAULT_SESSION_TITLE = 'New Session';
const FALLBACK_AGENT_ERROR_MESSAGE = '当前请求处理失败，请稍后重试。';

/** 发送消息时可选的元数据（对应后端 Orchestrator 中读取的 Message.metadata 字段） */
export interface SendMessageOptions {
  /** 主动激活的技能名列表（Web 端技能面板选择的技能） */
  activatedSkills?: string[];
  /** 主动激活的工具名列表（Web 端技能面板选择的工具） */
  activatedTools?: string[];
  /** 工作模式命令（Spec / Plan 等快捷命令） */
  workModeCommand?: 'spec' | 'plan';
}

function buildSessionTitle(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  if (!trimmed) return DEFAULT_SESSION_TITLE;
  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
}

function sanitizeAgentErrorMessage(message?: string): string {
  const trimmed = message?.trim();
  if (!trimmed) {
    return FALLBACK_AGENT_ERROR_MESSAGE;
  }

  if (/sorry, an error occurred while handling the request/i.test(trimmed)) {
    return FALLBACK_AGENT_ERROR_MESSAGE;
  }

  return trimmed;
}

function normalizeAssistantText(text?: string): string {
  const trimmed = text?.trim();
  if (!trimmed) return '';

  const finalMatch = trimmed.match(/<final_answer>([\s\S]*?)<\/final_answer>/i);
  if (finalMatch) {
    return finalMatch[1].trim();
  }

  return trimmed
    .replace(/^<final_answer>\s*/i, '')
    .replace(/\s*<\/final_answer>$/i, '')
    .trim();
}

function mapHistoryMessage(sessionId: string, message: { messageId: string; role: 'user' | 'assistant' | 'system'; content: string; timestamp: number }): ChatMessage {
  const text = message.role === 'assistant' ? normalizeAssistantText(message.content) : message.content;
  return {
    id: message.messageId,
    sessionId,
    role: message.role,
    content: [{ type: 'text', text }],
    timestamp: new Date(message.timestamp).toISOString(),
    status: 'sent',
  };
}

/**
 * 将渠道历史消息（ChannelMessage）映射为 ChatMessage
 *
 * 渠道消息额外携带来源用户信息（userId），用于在消息气泡上显示"来自:xxx"
 */
function mapChannelMessage(sessionId: string, message: ChannelMessage): ChatMessage {
  const text = message.role === 'assistant' ? normalizeAssistantText(message.content) : message.content;
  return {
    id: message.messageId,
    sessionId,
    role: message.role,
    content: [{ type: 'text', text }],
    timestamp: new Date(message.timestamp).toISOString(),
    status: 'sent',
    externalSource: {
      sourceChannel: message.channelId,
      sourceUserId: message.userId,
    },
  };
}

/**
 * 将 WebSocket channel.message 事件的 payload 映射为 ChatMessage
 *
 * 事件结构见服务端 bootstrap.routeInbound 和 agent-bridge.ts
 */
function mapChannelEventMessage(sessionId: string, payload: {
  sourceChannel: string;
  sourceUserId?: string;
  sourceUsername?: string;
  sourceDisplayName?: string;
  chatType?: 'private' | 'group';
  groupId?: string;
  groupName?: string;
  fromWebMonitor?: boolean;
  message: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    messageId: string;
    timestamp: number;
  };
}): ChatMessage {
  const text = payload.message.role === 'assistant' ? normalizeAssistantText(payload.message.content) : payload.message.content;
  return {
    id: payload.message.messageId,
    sessionId,
    role: payload.message.role,
    content: [{ type: 'text', text }],
    timestamp: new Date(payload.message.timestamp).toISOString(),
    status: 'sent',
    externalSource: {
      sourceChannel: payload.sourceChannel,
      sourceUserId: payload.sourceUserId,
      sourceUsername: payload.sourceUsername,
      sourceDisplayName: payload.sourceDisplayName,
      chatType: payload.chatType,
      groupId: payload.groupId,
      groupName: payload.groupName,
      fromWebMonitor: payload.fromWebMonitor,
    },
  };
}

export function useChat(sessionId: string) {
  const {
    messagesBySession,
    addMessage,
    updateMessage,
    appendStreamingContent,
    startStreaming,
    finishStreaming,
    clearStreamingContent,
    streamingContent,
    streamingReasoning,
    setStreamingReasoning,
    setInputDraft,
    setIsSending,
    isSending,
    setSessionMessages,
  } = useChatStore();

  const sessions = useSessionStore((state) => state.sessions);
  const upsertSession = useSessionStore((state) => state.upsertSession);
  const markSessionSynced = useSessionStore((state) => state.markSessionSynced);

  const sessionRef = useRef(sessionId);
  const lastAssistantMessageRef = useRef<string | null>(null);
  /** 最近一次自己发送的用户消息内容（用于在 handleMessageSent 中去重） */
  const lastSelfSentContentRef = useRef<{ content: string; time: number } | null>(null);
  sessionRef.current = sessionId;

  const sendMessage = useCallback(
    async (content: string, files?: File[], options: SendMessageOptions = {}) => {
      const sid = sessionRef.current;
      setIsSending(true);

      // 提取技能面板注入的元数据
      const { activatedSkills, activatedTools, workModeCommand } = options;

      const attachments: GatewayAttachment[] = [];
      if (files?.length) {
        for (const file of files) {
          attachments.push(await fileToGatewayAttachment(file));
        }
      }

      const blocks: ChatMessage['content'] = [];
      if (content.trim()) {
        blocks.push({ type: 'text', text: content });
      }
      attachments.forEach((attachment) => {
        blocks.push({
          type: 'file',
          name: attachment.name,
          url: attachment.url,
          size: attachment.size,
          mimeType: attachment.mimeType,
        });
      });

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: sid,
        role: 'user',
        content: blocks,
        timestamp: new Date().toISOString(),
        status: 'sending',
      };

      addMessage(userMessage);

      // 记录本次发送的内容指纹，供 handleMessageSent 去重（防止服务端广播回自己的消息被重复添加）
      lastSelfSentContentRef.current = {
        content: content.trim(),
        time: Date.now(),
      };

      try {
        // ── 监控会话走反向推送 API ──
        // 不调用 chat.send WebSocket 请求，而是调用 POST /api/channels/:channelId/reply
        // 将消息发送给最近一个活跃外部用户（从历史消息中查找）
        if (isMonitorSession(sid)) {
          const monitorConfig = getMonitorSessionConfig(sid);
          if (!monitorConfig) {
            throw new Error('监控会话配置缺失');
          }

          // 从当前会话消息列表中找到最近一个有 sourceUserId 的非 Web 监控消息
          // 作为反向推送的目标用户
          const currentMessages = messagesBySession[sid] ?? [];
          const lastExternalUser = [...currentMessages]
            .reverse()
            .find((msg) => msg.externalSource?.sourceUserId && !msg.externalSource?.fromWebMonitor);

          if (!lastExternalUser?.externalSource?.sourceUserId) {
            throw new Error('暂无活跃外部用户，无法发送消息。请等待外部用户先发消息后 再回复。');
          }

          const targetUserId = lastExternalUser.externalSource.sourceUserId;
          const chatType = lastExternalUser.externalSource.chatType ?? 'private';
          const groupId = lastExternalUser.externalSource.groupId;

          await replyToChannelUser(monitorConfig.monitorChannel, {
            userId: targetUserId,
            chatType,
            groupId,
            content,
          });

          // Web 端不立即添加"已发送"消息，等服务端 channel.message 事件回环时再添加
          // 这样可以避免重复，并保证多端一致
          // 但如果服务端回环失败，用户会看不到消息，所以这里移除 sending 状态消息
          updateMessage(userMessage.id, (msg) => ({ ...msg, status: 'sent' }));
        } else {
          // ── 普通会话走 WebSocket chat.send ──
          // 将技能面板激活项作为 metadata 传递到后端 Orchestrator
          // 后端会优先按 activatedSkills 注入技能说明，按 activatedTools
          // 突出工具，按 workModeCommand 启用强约束工作流
          await wsClient.request('chat.send', {
            sessionId: sid,
            messageId: userMessage.id,
            content,
            attachments,
            channelId: SHARED_CHANNEL_ID,
            userId: SHARED_USER_ID,
            // 技能/工具/工作模式 激活元数据
            activatedSkills,
            activatedTools,
            workModeCommand,
          });

          updateMessage(userMessage.id, (msg) => ({ ...msg, status: 'sent' }));

          if (content.trim()) {
            const session = sessions.find((item) => item.id === sid);
            if (session) {
              upsertSession({
                ...session,
                title: session.title && session.title !== DEFAULT_SESSION_TITLE ? session.title : buildSessionTitle(content),
                updatedAt: new Date().toISOString(),
              });
            }
          }
        }
      } catch (error) {
        // chat.send 本身失败（网络错误等），将用户消息标记为错误并结束等待状态
        updateMessage(userMessage.id, (msg) => ({
          ...msg,
          status: 'error',
          error: error instanceof Error ? error.message : '发送失败',
        }));
        // 只有 chat.send 本身失败时才在此处结束 isSending
        // 正常流程中，isSending 由 handleDone / handleError 在 Agent 完成后结束
        setIsSending(false);
      }
      // 注意：isSending(false) 不放在 finally 中！
      // chat.send 的服务端响应只是一个确认回执（几乎瞬间返回），Agent 在此之后异步执行。
      // 若在 finally 中立即置 false，TypingIndicator 将只闪烁几毫秒，用户看不到等待效果。
      // isSending 的正确结束时机是 handleDone（Agent 完成）或 handleError（Agent 出错）。
    },
    [addMessage, updateMessage, setIsSending, sessions, upsertSession, messagesBySession],
  );

  useEffect(() => {
    let cancelled = false;

    const loadHistory = async () => {
      if (!sessionId) return;
      try {
        // ── 监控会话：走渠道历史 API ──
        if (isMonitorSession(sessionId)) {
          const monitorConfig = getMonitorSessionConfig(sessionId);
          if (!monitorConfig) return;
          const response = await fetchChannelMessages(monitorConfig.monitorChannel, 200);
          if (cancelled) return;
          const messages: ChatMessage[] = response.messages
            .map((message) => mapChannelMessage(sessionId, message));
          setSessionMessages(sessionId, messages);
          markSessionSynced(sessionId);
          return;
        }

        // ── 普通会话：走 WebSocket session.bind + chat 历史 ──
        if (wsClient.state !== 'connected') {
          await wsClient.connect();
        }
        await wsClient.request('session.bind', {
          sessionId,
          channelId: SHARED_CHANNEL_ID,
          userId: SHARED_USER_ID,
        });
        const history = await fetchChatHistory(sessionId, 0, 100);
        if (cancelled) return;
        const messages: ChatMessage[] = history.messages
          .slice()
          .sort((a, b) => a.timestamp - b.timestamp)
          .map((message) => mapHistoryMessage(sessionId, message));
        setSessionMessages(sessionId, messages);
        markSessionSynced(sessionId);
      } catch {
        // Keep local messages if history sync fails.
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [markSessionSynced, sessionId, setSessionMessages]);

  useEffect(() => {
    let currentAssistantId: string | null = null;

    // 处理 reasoning 流式事件（AI 思考过程）
    const handleReasoningDelta = (event: GatewayMessage<{
      sessionId: string;
      delta: string;
      accumulated: string;
    }>) => {
      if (event.payload.sessionId !== sessionRef.current) return;
      // 设置思考内容到 store，供 TypingIndicator 实时显示
      setStreamingReasoning(event.payload.accumulated || event.payload.delta);
    };

    // 处理其他端发送的用户消息（跨端同步）
    const handleMessageSent = (event: GatewayMessage<{
      sessionId: string;
      channelId: string;
      userId: string;
      content: string;
      messageType: string;
      role: string;
      source: string;
    }>) => {
      const remoteSessionId = event.payload.sessionId;
      // 只处理当前会话的消息
      if (remoteSessionId !== sessionRef.current) return;
      // 跳过自身发送的消息（通过 source 字段判断）
      if (event.payload.source !== 'cross-client') return;

      // 去重：如果内容与最近自己发送的消息完全匹配（5s 窗口），跳过
      // 防止服务端 broadcastToSession 把自己的消息重复广播回来
      const selfSent = lastSelfSentContentRef.current;
      if (
        selfSent &&
        selfSent.content === (event.payload.content ?? '').trim() &&
        Date.now() - selfSent.time < 5000
      ) {
        return;
      }

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: remoteSessionId,
        role: 'user',
        content: [{ type: 'text', text: event.payload.content }],
        timestamp: new Date(event.timestamp).toISOString(),
        status: 'sent',
      };
      addMessage(userMessage);
    };

    const handleDelta = (event: GatewayMessage<ChatDeltaEvent>) => {
      if (event.payload.sessionId !== sessionRef.current) return;
      const { delta, accumulated } = event.payload;
      const normalizedAccumulated = normalizeAssistantText(accumulated || delta);

      if (!currentAssistantId) {
        currentAssistantId = `assistant-${crypto.randomUUID()}`;
        startStreaming(currentAssistantId);
        addMessage({
          id: currentAssistantId,
          sessionId: sessionRef.current,
          role: 'assistant',
          content: [{ type: 'text', text: normalizedAccumulated }],
          timestamp: new Date().toISOString(),
          status: 'streaming',
          reasoning: event.payload.reasoning,
        });
        lastAssistantMessageRef.current = normalizedAccumulated;
        return;
      }

      updateMessage(currentAssistantId, (msg) => ({
        ...msg,
        content: [{ type: 'text', text: normalizedAccumulated }],
      }));
      appendStreamingContent(delta);
      lastAssistantMessageRef.current = normalizedAccumulated;
    };

    const handleDone = (event: GatewayMessage<ChatDoneEvent>) => {
      if (event.payload.sessionId !== sessionRef.current) return;
      if (currentAssistantId) {
        const { totalContent, totalReasoning, reasoningDurationMs, error } = event.payload;
        const normalizedText = normalizeAssistantText(totalContent);
        if (error && totalContent) {
          updateMessage(currentAssistantId, (msg) => ({
            ...msg,
            content: [{ type: 'text', text: normalizedText }],
            status: 'error',
          }));
        } else {
          updateMessage(currentAssistantId, (msg) => ({
            ...msg,
            content: [{ type: 'text', text: normalizedText || '' }],
            reasoning: totalReasoning ?? msg.reasoning,
            reasoningDurationMs: reasoningDurationMs ?? msg.reasoningDurationMs,
            status: 'sent',
          }));
        }
        finishStreaming();
        lastAssistantMessageRef.current = normalizedText || lastAssistantMessageRef.current;
        currentAssistantId = null;
      } else {
        void fetchChatHistory(event.payload.sessionId, 0, 100).then((history) => {
          if (event.payload.sessionId !== sessionRef.current) return;
          const messages: ChatMessage[] = history.messages
            .slice()
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((message) => mapHistoryMessage(event.payload.sessionId, message));
          setSessionMessages(event.payload.sessionId, messages);
          const lastAssistant = messages.filter((message) => message.role === 'assistant').at(-1);
          const firstBlock = lastAssistant?.content?.[0];
          lastAssistantMessageRef.current = firstBlock?.type === 'text' ? firstBlock.text : null;
          markSessionSynced(event.payload.sessionId, event.timestamp);
        }).catch(() => undefined);
      }
      setIsSending(false);
    };

    const handleError = (event: GatewayMessage<{ sessionId?: string; code?: string; message?: string }>) => {
      const currentSessionId = event.payload.sessionId ?? sessionRef.current;
      if (currentSessionId !== sessionRef.current) return;
      const messageText = sanitizeAgentErrorMessage(event.payload.message);

      if (currentAssistantId) {
        updateMessage(currentAssistantId, (msg) => ({
          ...msg,
          content: [{ type: 'text', text: messageText }],
          status: 'error',
        }));
        lastAssistantMessageRef.current = messageText;
      } else if (lastAssistantMessageRef.current !== messageText) {
        const errorId = `system-${crypto.randomUUID()}`;
        addMessage({
          id: errorId,
          sessionId: currentSessionId,
          role: 'system',
          content: [{ type: 'text', text: messageText }],
          timestamp: new Date().toISOString(),
          status: 'sent',
        });
      }

      finishStreaming();
      currentAssistantId = null;
      setIsSending(false);
    };

    // ── 监控会话：订阅 channel.message 事件 ──
    // 服务端在 bootstrap.routeInbound（用户消息）和 agent-bridge.invoke（助手回复）中推送
    // 根据 sourceChannel 路由到对应监控会话
    const handleChannelMessage = (event: GatewayMessage<{
      sourceChannel: string;
      sourceUserId?: string;
      sourceUsername?: string;
      sourceDisplayName?: string;
      sourceSessionId?: string;
      chatType?: 'private' | 'group';
      groupId?: string;
      groupName?: string;
      fromWebMonitor?: boolean;
      message: {
        role: 'user' | 'assistant' | 'system';
        content: string;
        messageId: string;
        timestamp: number;
      };
    }>) => {
      const monitorConfig = getMonitorSessionByChannel(event.payload.sourceChannel);
      if (!monitorConfig) return;
      // 只处理当前会话的事件（其他监控会话由对应的 useChat 实例处理）
      if (monitorConfig.id !== sessionRef.current) return;

      const message = mapChannelEventMessage(monitorConfig.id, event.payload);
      // 去重：如果消息 ID 已存在则不重复添加
      const existing = (useChatStore.getState().messagesBySession[monitorConfig.id] ?? [])
        .some((m) => m.id === message.id);
      if (!existing) {
        addMessage(message);
      }
    };

    wsClient.on('chat.reasoning_delta', handleReasoningDelta);
    wsClient.on('chat.message_sent', handleMessageSent);
    wsClient.on('chat.delta', handleDelta);
    wsClient.on('chat.done', handleDone);
    wsClient.on('chat.error', handleError);
    wsClient.on('channel.message', handleChannelMessage);

    return () => {
      wsClient.off('chat.reasoning_delta', handleReasoningDelta);
      wsClient.off('chat.message_sent', handleMessageSent);
      wsClient.off('chat.delta', handleDelta);
      wsClient.off('chat.done', handleDone);
      wsClient.off('chat.error', handleError);
      wsClient.off('channel.message', handleChannelMessage);
    };
  }, [addMessage, appendStreamingContent, finishStreaming, markSessionSynced, setIsSending, setSessionMessages, startStreaming, updateMessage, setStreamingReasoning, sessionId]);

  const sessionMessages = (messagesBySession[sessionId] ?? [])
    .slice()
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return {
    messages: sessionMessages,
    streamingContent,
    streamingReasoning,
    isSending,
    sendMessage,
    setInputDraft,
    clearStreamingContent,
  };
}
