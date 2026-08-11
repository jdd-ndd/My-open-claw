import { create } from 'zustand';
import type { ConnectionStatus } from '@/types/gateway';
import type { AgentState } from '@/types/agent';

type AppEvent =
  | { type: 'SESSION_SWITCHED'; payload: { sessionId: string } }
  | { type: 'CONNECTION_STATUS_CHANGED'; payload: { status: ConnectionStatus } }
  | { type: 'SETTINGS_CHANGED'; payload: { key: string; value: unknown } };

interface AppState {
  connectionStatus: ConnectionStatus;
  sidebarOpen: boolean;
  globalError: string | null;
  agentState: AgentState | null;
  settingsPanelOpen: boolean;
  dispatch: (event: AppEvent) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setGlobalError: (error: string | null) => void;
  setAgentState: (state: AgentState | null) => void;
  setSettingsPanelOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  connectionStatus: 'idle',
  sidebarOpen: true,
  globalError: null,
  agentState: null,
  settingsPanelOpen: false,

  dispatch: (event) => {
    switch (event.type) {
      case 'CONNECTION_STATUS_CHANGED':
        set({ connectionStatus: event.payload.status });
        break;
      case 'SESSION_SWITCHED':
        // [占位] 会话切换事件暂不执行额外逻辑
        break;
      case 'SETTINGS_CHANGED':
        // [占位] 设置变更事件暂不执行额外逻辑
        break;
    }
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setGlobalError: (error) => set({ globalError: error }),
  setAgentState: (state) => set({ agentState: state }),
  setSettingsPanelOpen: (open) => set({ settingsPanelOpen: open }),
}));
