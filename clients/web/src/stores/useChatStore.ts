import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ChatMessage } from '@/types/message';

interface ChatState {
  /** 按 sessionId 索引的消息 map — 切换会话不丢历史 */
  messagesBySession: Record<string, ChatMessage[]>;
  /** 兼容旧 API:返回当前活跃 session 的消息(由 ChatContainer 通过 selector 派生) */
  streamingContent: string;
  streamingReasoning: string;
  streamingMessageId: string | null;
  inputDraft: string;
  isSending: boolean;
  activeSessionId: string | null;

  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updater: (msg: ChatMessage) => ChatMessage) => void;
  removeMessage: (id: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  appendStreamingContent: (chunk: string) => void;
  setStreamingReasoning: (reasoning: string) => void;
  startStreaming: (messageId: string) => void;
  finishStreaming: () => void;
  clearStreamingContent: () => void;
  setInputDraft: (draft: string) => void;
  setIsSending: (sending: boolean) => void;
  /** 删某个 session 下的全部消息(用于 deleteSession) */
  clearMessages: (sessionId?: string) => void;
  setSessionMessages: (sessionId: string, messages: ChatMessage[]) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messagesBySession: {},
      streamingContent: '',
      streamingReasoning: '',
      streamingMessageId: null,
      inputDraft: '',
      isSending: false,
      activeSessionId: null,

      addMessage: (message) =>
        set((state) => {
          const list = state.messagesBySession[message.sessionId] ?? [];
          return {
            messagesBySession: {
              ...state.messagesBySession,
              [message.sessionId]: [...list, message],
            },
          };
        }),

      updateMessage: (id, updater) =>
        set((state) => {
          const next: Record<string, ChatMessage[]> = {};
          for (const [sid, list] of Object.entries(state.messagesBySession)) {
            next[sid] = list.map((msg) => (msg.id === id ? updater(msg) : msg));
          }
          return { messagesBySession: next };
        }),

      removeMessage: (id) =>
        set((state) => {
          const next: Record<string, ChatMessage[]> = {};
          for (const [sid, list] of Object.entries(state.messagesBySession)) {
            next[sid] = list.filter((msg) => msg.id !== id);
          }
          return { messagesBySession: next };
        }),

      setActiveSession: (sessionId) =>
        set({ activeSessionId: sessionId, streamingContent: '', streamingReasoning: '', streamingMessageId: null }),

      appendStreamingContent: (chunk) =>
        set((state) => ({
          streamingContent: state.streamingContent + chunk,
        })),

      setStreamingReasoning: (reasoning) =>
        set({
          streamingReasoning: reasoning,
        }),

      startStreaming: (messageId) =>
        set({ streamingMessageId: messageId, streamingContent: '', streamingReasoning: '' }),

      // 仅清理流式状态，不修改消息内容
      // handleDone/handleError 已通过 updateMessage 完整设置了最终 content
      finishStreaming: () => {
        set({ streamingContent: '', streamingReasoning: '', streamingMessageId: null });
      },

      clearStreamingContent: () => set({ streamingContent: '', streamingReasoning: '', streamingMessageId: null }),

      setInputDraft: (draft) => set({ inputDraft: draft }),

      setIsSending: (sending) => set({ isSending: sending }),

      clearMessages: (sessionId) => {
        if (sessionId) {
          set((state) => {
            const next = { ...state.messagesBySession };
            delete next[sessionId];
            return { messagesBySession: next };
          });
        } else {
          // 无参数 = 清空全部(用于全量重置)
          set({ messagesBySession: {} });
        }
      },

      setSessionMessages: (sessionId, messages) =>
        set((state) => ({
          messagesBySession: {
            ...state.messagesBySession,
            [sessionId]: messages,
          },
        })),
    }),
    {
      name: 'myopenclaw-chat-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        // 持久化时只存非 streaming 状态的消息
        const filtered: Record<string, ChatMessage[]> = {};
        for (const [sid, list] of Object.entries(state.messagesBySession)) {
          filtered[sid] = list.filter((m) => m.status !== 'streaming');
        }
        return {
          messagesBySession: filtered,
          inputDraft: state.inputDraft,
        };
      },
      version: 2,
      migrate: (persisted: unknown, fromVersion: number) => {
        // v1 → v2: messages: ChatMessage[] → messagesBySession: Record<string, ChatMessage[]>
        if (fromVersion < 2 && persisted && typeof persisted === 'object') {
          const p = persisted as { messages?: ChatMessage[] };
          if (Array.isArray(p.messages)) {
            const map: Record<string, ChatMessage[]> = {};
            for (const m of p.messages) {
              (map[m.sessionId] ??= []).push(m);
            }
            return { messagesBySession: map, inputDraft: '' };
          }
        }
        return persisted as ChatState;
      },
    }
  )
);
