import { create } from 'zustand';
import type { Session } from '@/types/session';
import { isMonitorSession } from '@/config/sync-defaults';

interface SessionState {
  sessions: Session[];
  currentSessionId: string | null;
  loaded: boolean;
  loading: boolean;
  lastSyncedSessionId: string | null;
  lastSyncedAt: string | null;

  setSessions: (sessions: Session[]) => void;
  setCurrentSession: (id: string | null) => void;
  upsertSession: (session: Session) => void;
  removeSession: (id: string) => void;
  setLoading: (loading: boolean) => void;
  markSessionSynced: (sessionId: string, syncedAt?: string) => void;
  getCurrentSession: () => Session | undefined;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: [],
  currentSessionId: null,
  loaded: false,
  loading: false,
  lastSyncedSessionId: null,
  lastSyncedAt: null,

  setSessions: (sessions) =>
    set((state) => {
      // 检查当前选中的会话是否存在于新的会话列表中
      const isCurrentMonitor = state.currentSessionId && isMonitorSession(state.currentSessionId);
      const hasCurrent = state.currentSessionId ? sessions.some((session) => session.id === state.currentSessionId) : false;

      // 如果当前选中的是监控会话（虚拟会话，不在服务端列表中），保留其选中状态
      // 如果当前选中的会话存在于新列表中，也保留选中状态
      // 否则切换到第一个会话
      let nextSessionId: string | null;
      if (isCurrentMonitor) {
        nextSessionId = state.currentSessionId;
      } else if (hasCurrent) {
        nextSessionId = state.currentSessionId;
      } else {
        nextSessionId = sessions[0]?.id ?? null;
      }

      return {
        sessions,
        loaded: true,
        currentSessionId: nextSessionId,
      };
    }),

  setCurrentSession: (id) => set({ currentSessionId: id }),

  upsertSession: (session) =>
    set((state) => {
      const existing = state.sessions.some((item) => item.id === session.id);
      return {
        sessions: existing
          ? state.sessions.map((item) => (item.id === session.id ? session : item))
          : [...state.sessions, session],
        currentSessionId: state.currentSessionId ?? session.id,
      };
    }),

  removeSession: (id) =>
    set((state) => {
      const sessions = state.sessions.filter((session) => session.id !== id);
      return {
        sessions,
        currentSessionId: state.currentSessionId === id ? sessions[0]?.id ?? null : state.currentSessionId,
      };
    }),

  setLoading: (loading) => set({ loading }),

  markSessionSynced: (sessionId, syncedAt) =>
    set({
      lastSyncedSessionId: sessionId,
      lastSyncedAt: syncedAt ?? new Date().toISOString(),
    }),

  getCurrentSession: () => {
    const { sessions, currentSessionId } = get();
    return sessions.find((session) => session.id === currentSessionId);
  },
}));
