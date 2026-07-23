import { create } from 'zustand';

interface Session {
  id: string;
  status: 'active' | 'idle' | 'closed';
}

interface ChatState {
  sessions: Session[];
  activeSessionId: string | null;
  setActiveSession: (id: string) => void;
  addSession: (session: Session) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  activeSessionId: null,
  setActiveSession: (id) => set({ activeSessionId: id }),
  addSession: (session) =>
    set((state) => ({ sessions: [...state.sessions, session] })),
}));
