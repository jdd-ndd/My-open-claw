import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createSession as createGatewaySession, deleteSession as deleteGatewaySession, listSessions, updateSession as updateGatewaySession } from '@/api/sessions';
import { useSessionStore } from '@/stores/useSessionStore';
import { useChatStore } from '@/stores/useChatStore';
import { wsClient } from '@/api/gateway';
import type { Session } from '@/types/session';
import type { ChatMessage } from '@/types/message';
import type { GatewayMessage } from '@/types/gateway';
import { SHARED_CHANNEL_ID, SHARED_USER_ID, MONITOR_SESSIONS, isMonitorSession } from '@/config/sync-defaults';

const DEFAULT_AGENT_ID = 'jarvis';
const DEFAULT_SESSION_TITLE = 'New Session';

/**
 * 构造两个虚拟监控会话（QQ机器人/飞书机器人对话同步窗口）
 *
 * 这两个会话纯前端维护，不调用 listSessions/createSession：
 *   - 历史通过 GET /api/channels/:channelId/messages 加载
 *   - 实时消息通过 WebSocket channel.message 事件推送
 *   - 反向发送通过 POST /api/channels/:channelId/reply
 *
 * pinnedAt 设为远未来时间，确保始终排在会话列表顶部
 */
function buildMonitorSessions(): Session[] {
  const farFuture = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();
  return MONITOR_SESSIONS.map((config) => ({
    id: config.id,
    title: config.title,
    createdAt: farFuture,
    updatedAt: farFuture,
    pinnedAt: farFuture,
    status: 'active' as const,
    channelId: SHARED_CHANNEL_ID,
    userId: SHARED_USER_ID,
    agentId: DEFAULT_AGENT_ID,
    metadata: {
      monitorChannel: config.monitorChannel,
      isMonitorSession: true,
      iconKey: config.iconKey,
    },
  }));
}

function toWebSession(session: Record<string, unknown>): Session {
  return {
    id: String(session.sessionId),
    title: String(session.title ?? DEFAULT_SESSION_TITLE),
    createdAt: new Date(Number(session.createdAt ?? Date.now())).toISOString(),
    updatedAt: new Date(Number(session.updatedAt ?? session.lastActiveAt ?? Date.now())).toISOString(),
    pinnedAt: session.pinnedAt ? new Date(Number(session.pinnedAt)).toISOString() : null,
    status: (session.status as Session['status']) ?? 'active',
    channelId: String(session.channelId ?? SHARED_CHANNEL_ID),
    userId: String(session.userId ?? SHARED_USER_ID),
    agentId: String(session.agentId ?? DEFAULT_AGENT_ID),
    metadata: (session.metadata as Record<string, unknown> | undefined) ?? {},
  };
}

function buildSessionTitleFromMessage(message: string): string {
  const text = message.trim().replace(/\s+/g, ' ');
  if (!text) return DEFAULT_SESSION_TITLE;
  return text.length > 18 ? `${text.slice(0, 18)}...` : text;
}

export function useSession() {
  const {
    sessions,
    currentSessionId,
    loaded,
    setSessions,
    setCurrentSession,
    upsertSession,
    removeSession,
    setLoading,
    markSessionSynced,
  } = useSessionStore();

  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const clearMessagesForSession = useChatStore((s) => s.clearMessages);
  const messagesBySession = useChatStore((s) => s.messagesBySession);
  const autoCreatingSessionRef = useRef(false);

  const refreshSessions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listSessions({ channelId: SHARED_CHANNEL_ID, userId: SHARED_USER_ID });
      const mapped = (response.sessions ?? []).map((session) => toWebSession(session as unknown as Record<string, unknown>));
      // setSessions 已修复：会保留监控会话的选中状态
      setSessions(mapped);
      // 监控会话的同步由 useChat hook 中的 loadHistory 处理，这里只处理普通会话
      if (currentSessionId && !isMonitorSession(currentSessionId) && mapped.some((session) => session.id === currentSessionId)) {
        markSessionSynced(currentSessionId);
      }
    } finally {
      setLoading(false);
    }
  }, [currentSessionId, markSessionSynced, setLoading, setSessions]);

  useEffect(() => {
    if (!loaded) {
      void refreshSessions();
    }
  }, [loaded, refreshSessions]);

  const sortedSessions = useMemo(() => {
    // 注入两个虚拟监控会话（QQ机器人/飞书机器人对话同步窗口）
    // 它们不入库，纯前端维护，始终置顶显示
    const monitorSessions = buildMonitorSessions();

    const sorted = [...sessions].sort((a, b) => {
      const aPinned = a.pinnedAt ? 1 : 0;
      const bPinned = b.pinnedAt ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;

      const aPinTime = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
      const bPinTime = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
      if (aPinTime !== bPinTime) return bPinTime - aPinTime;

      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    return [...monitorSessions, ...sorted];
  }, [sessions]);

  const createSession = useCallback(
    async (title?: string) => {
      const session = await createGatewaySession({
        agentId: DEFAULT_AGENT_ID,
        channelId: SHARED_CHANNEL_ID,
        userId: SHARED_USER_ID,
        title: title?.trim() || DEFAULT_SESSION_TITLE,
      });
      const mapped = toWebSession(session as unknown as Record<string, unknown>);
      upsertSession(mapped);
      setCurrentSession(mapped.id);
      setActiveSession(mapped.id);
      return mapped;
    },
    [setActiveSession, setCurrentSession, upsertSession],
  );

  const switchSession = useCallback(
    (id: string) => {
      setCurrentSession(id);
      setActiveSession(id);
    },
    [setCurrentSession, setActiveSession],
  );

  const renameSession = useCallback(
    async (id: string, title: string) => {
      const nextTitle = title.trim() || DEFAULT_SESSION_TITLE;
      const updated = await updateGatewaySession(id, { title: nextTitle });
      upsertSession(toWebSession(updated as unknown as Record<string, unknown>));
    },
    [upsertSession],
  );

  const autoRenameFromFirstMessage = useCallback(
    async (sessionId: string) => {
      const messages = messagesBySession[sessionId] ?? [];
      const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.length > 0);
      const firstText = firstUserMessage?.content.find((block): block is Extract<ChatMessage['content'][number], { type: 'text' }> => block.type === 'text')?.text;

      if (!firstText) return;

      const updated = await updateGatewaySession(sessionId, { title: buildSessionTitleFromMessage(firstText) });
      upsertSession(toWebSession(updated as unknown as Record<string, unknown>));
    },
    [messagesBySession, upsertSession],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      // 监控会话是虚拟会话，不允许删除
      if (MONITOR_SESSIONS.some((s) => s.id === id)) {
        return;
      }
      await deleteGatewaySession(id);
      removeSession(id);
      clearMessagesForSession(id);
    },
    [removeSession, clearMessagesForSession],
  );

  const togglePinSession = useCallback(
    async (id: string) => {
      const session = sessions.find((item) => item.id === id);
      if (!session) return;
      const updated = await updateGatewaySession(id, {
        pinnedAt: session.pinnedAt ? null : new Date().toISOString(),
      });
      upsertSession(toWebSession(updated as unknown as Record<string, unknown>));
    },
    [sessions, upsertSession],
  );

  const ensureSession = useCallback(async () => {
    if (!loaded || autoCreatingSessionRef.current) {
      return;
    }

    // 当前选中的是监控会话（虚拟会话，不在 store 的 sessions 列表中），保持选中状态
    if (currentSessionId && isMonitorSession(currentSessionId)) {
      return;
    }

    const hasCurrent = currentSessionId && sessions.find((session) => session.id === currentSessionId);
    if (!hasCurrent) {
      if (sessions.length > 0) {
        switchSession(sortedSessions[0].id);
        return;
      }

      autoCreatingSessionRef.current = true;
      try {
        await createSession();
      } finally {
        autoCreatingSessionRef.current = false;
      }
    }
  }, [createSession, currentSessionId, loaded, sessions, sortedSessions, switchSession]);

  useEffect(() => {
    if (currentSessionId) {
      setActiveSession(currentSessionId);
    }
  }, [currentSessionId, setActiveSession]);

  // ── 跨端会话同步：订阅服务器推送的 session.* 事件 ──
  // 其他端创建/修改/删除会话时，服务器会向同 channel 下所有连接广播
  // 本端收到后实时更新本地会话列表，无需用户手动刷新
  useEffect(() => {
    /** session.created：其他端新建会话 */
    const handleCreated = (event: GatewayMessage<{ session: Record<string, unknown>; source?: string }>) => {
      const raw = event.payload?.session;
      if (!raw) return;
      upsertSession(toWebSession(raw));
    };

    /** session.updated：其他端修改标题/置顶/状态 */
    const handleUpdated = (event: GatewayMessage<{ session: Record<string, unknown>; changes?: Record<string, unknown> }>) => {
      const raw = event.payload?.session;
      if (!raw) return;
      upsertSession(toWebSession(raw));
    };

    /** session.deleted：其他端删除会话 */
    const handleDeleted = (event: GatewayMessage<{ sessionId: string; channelId?: string }>) => {
      const sid = event.payload?.sessionId;
      if (!sid) return;
      removeSession(sid);
      clearMessagesForSession(sid);
    };

    wsClient.on('session.created', handleCreated);
    wsClient.on('session.updated', handleUpdated);
    wsClient.on('session.deleted', handleDeleted);

    return () => {
      wsClient.off('session.created', handleCreated);
      wsClient.off('session.updated', handleUpdated);
      wsClient.off('session.deleted', handleDeleted);
    };
  }, [upsertSession, removeSession, clearMessagesForSession]);

  return {
    sessions: sortedSessions,
    currentSessionId,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    pinSession: togglePinSession,
    autoRenameFromFirstMessage,
    ensureSession,
    refreshSessions,
    channelId: SHARED_CHANNEL_ID,
    userId: SHARED_USER_ID,
  };
}
