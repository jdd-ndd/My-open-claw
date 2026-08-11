import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useAppStore } from '@/stores/useAppStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { cn } from '@/utils/cn';
import { SettingsPanel } from '../settings/SettingsPanel';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const settingsPanelOpen = useAppStore((s) => s.settingsPanelOpen);
  const setSettingsPanelOpen = useAppStore((s) => s.setSettingsPanelOpen);
  const currentSessionId = useSessionStore((s) => s.currentSessionId);

  return (
    <div className="relative flex h-full overflow-hidden bg-[hsl(var(--background))] transition-colors duration-500">
      <div className="pointer-events-none absolute inset-0 opacity-25 dark:opacity-20">
        <div className="absolute left-[-12%] top-[-10%] h-[34rem] w-[34rem] rounded-full bg-primary/12 blur-3xl" />
        <div className="absolute bottom-[-16%] right-[-10%] h-[26rem] w-[26rem] rounded-full bg-teal/10 blur-3xl" />
      </div>

      <div className="relative z-10 flex h-full w-full gap-0 p-0 md:gap-4 md:p-4">
        <div
          className={cn(
            'hidden flex-shrink-0 overflow-hidden rounded-2xl border border-border/60 bg-card/78 shadow-[0_24px_80px_-40px_rgba(0,0,0,0.65)] backdrop-blur-xl transition-all duration-300 ease-out md:flex',
            sidebarOpen ? 'md:w-[300px] lg:w-[320px]' : 'md:w-0 md:border-transparent md:bg-transparent md:shadow-none',
          )}
        >
          <Sidebar />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden md:rounded-[28px] md:border md:border-border/60 md:bg-card/62 md:shadow-[0_32px_90px_-48px_rgba(0,0,0,0.75)] md:backdrop-blur-xl">
          <Header />
          <div className="flex-1 overflow-hidden">{children}</div>
        </div>
      </div>

      <SettingsPanel
        open={settingsPanelOpen}
        onClose={() => setSettingsPanelOpen(false)}
        currentSessionId={currentSessionId}
      />
    </div>
  );
};
