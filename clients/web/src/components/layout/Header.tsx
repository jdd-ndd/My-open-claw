import React, { useEffect, useState } from 'react';
import { Menu, Settings, Sun, Moon } from 'lucide-react';
import { useAppStore } from '@/stores/useAppStore';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/utils/cn';
import { fetchServerTime } from '@/api/time';

export const Header: React.FC = () => {
  const [serverTime, setServerTime] = useState('');
  const { resolvedTheme, setTheme } = useTheme();
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setSettingsPanelOpen = useAppStore((s) => s.setSettingsPanelOpen);
  const agentState = useAppStore((s) => s.agentState);

  const getConnectionLabel = () => {
    switch (connectionStatus) {
      case 'connected': return '已连接';
      case 'connecting': return '连接中';
      case 'reconnecting': return '重连中';
      default: return '未连接';
    }
  };

  const getAgentStatusLabel = () => {
    if (!agentState) return null;
    switch (agentState.status) {
      case 'thinking': return '思考中';
      case 'tool_calling': return '调用工具';
      case 'streaming': return '正在回复';
      case 'error': return '出错';
      default: return null;
    }
  };

  const getStatusDot = () => {
    switch (connectionStatus) {
      case 'connected': return 'status-dot status-dot-connected';
      case 'connecting':
      case 'reconnecting': return 'status-dot status-dot-connecting';
      default: return 'status-dot status-dot-disconnected';
    }
  };

  useEffect(() => {
    let alive = true;

    const syncTime = async () => {
      try {
        const result = await fetchServerTime();
        if (alive) {
          setServerTime(new Date(result.serverTimestamp).toLocaleString());
        }
      } catch {
        if (alive) {
          setServerTime(new Date().toLocaleString());
        }
      }
    };

    void syncTime();
    const timer = setInterval(() => {
      setServerTime(new Date().toLocaleString());
    }, 1000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const agentLabel = getAgentStatusLabel();

  return (
    <header className="relative z-20 flex h-16 flex-shrink-0 items-center gap-3 border-b border-border/60 bg-background/30 px-4 backdrop-blur-md md:px-6">
      <button
        onClick={toggleSidebar}
        className="p-2 rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
        title="切换侧边栏"
      >
        <Menu className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-2.5">
        <h1 className="font-display font-semibold text-[15px] tracking-tight text-foreground">
          MyOpenClaw
        </h1>
        <span className="hidden sm:inline text-[11px] px-1.5 py-0.5 rounded-md bg-gradient-primary text-primary-foreground font-medium">
          BETA
        </span>
      </div>

      {agentLabel && (
        <div className={cn(
          'flex items-center gap-1.5 text-xs ml-2 px-2.5 py-1 rounded-full border transition-all duration-300',
          agentState?.status === 'streaming' && 'border-primary/30 bg-primary/5 text-primary animate-pulse-soft',
          agentState?.status === 'error' && 'border-red-500/30 bg-red-500/5 text-destructive',
          agentState?.status === 'thinking' && 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400',
          agentState?.status === 'tool_calling' && 'border-purple-500/30 bg-purple-500/5 text-purple-600 dark:text-purple-400',
        )}>
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
          {agentLabel}
        </div>
      )}

      <div className="flex-1" />
      <div className="flex items-center gap-1.5">
        <div className="hidden lg:flex items-center gap-1.5 rounded-xl border border-border/45 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground">
          {serverTime || '获取时间中...'}
        </div>

        <div className="flex items-center gap-1.5 rounded-xl border border-border/45 bg-muted/30 px-3 py-1.5">
          <span className={getStatusDot()} />
          <span className="text-xs text-muted-foreground font-medium hidden sm:inline">
            {getConnectionLabel()}
          </span>
        </div>

        <button
          className="p-2 rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          title={resolvedTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
        >
          {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <button
          className="p-2 rounded-lg hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
          onClick={() => setSettingsPanelOpen(true)}
          title="设置"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
