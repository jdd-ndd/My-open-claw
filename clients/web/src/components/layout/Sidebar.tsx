import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquarePlus,
  MessageSquare,
  Sparkles,
  ChevronRight,
  MoreVertical,
  Pin,
  PinOff,
  PencilLine,
  Trash2,
  ArrowUpDown,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { cn } from '@/utils/cn';
import { isMonitorSession } from '@/config/sync-defaults';

/** QQ 渠道图标 */
const QQIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M12.003 2c-2.265 0-4.113 1.83-4.113 4.082 0 .523.105 1.024.293 1.483-1.075.642-2.418 1.966-3.038 3.798-.673 1.99-.583 4.07-.583 4.07s-.205 1.207-.937 2.484c-.46.797-1.504 2.117-1.504 2.117s-.355.724.687 1.04c.46.137.964.066 1.426-.339.24-.215.477-.534.687-.967.103.343.27.674.51.974.346.428.804.74 1.347.924-.275.27-.508.61-.652 1.018-.227.65-.158 1.378-.158 1.378s.04.617.677.617c.638 0 1.41-.516 1.952-1.41.453-.748.434-1.494.434-1.494s.593.183 1.41.183c.815 0 1.408-.183 1.408-.183s-.018.746.435 1.494c.542.894 1.314 1.41 1.95 1.41.638 0 .678-.617.678-.617s.07-.728-.157-1.378c-.144-.408-.377-.747-.652-1.018.543-.184 1.001-.496 1.347-.924.24-.3.407-.631.51-.974.21.433.447.752.687.967.462.405.966.476 1.426.339 1.042-.316.687-1.04.687-1.04s-1.044-1.32-1.504-2.117c-.732-1.277-.937-2.484-.937-2.484s.09-2.08-.583-4.07c-.62-1.832-1.963-3.156-3.038-3.798.188-.46.293-.96.293-1.483C16.116 3.83 14.268 2 12.003 2z" />
  </svg>
);

/** 飞书渠道图标 */
const FeishuIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 6.6l5.4 2.4 9-5.4-2.4 6 6 2.4-9 5.4 2.4-6-11.4-4.8zm6 6l9 5.4-2.4 6-9-5.4 2.4-6z" />
  </svg>
);

const BrandLogo: React.FC = () => (
  <svg viewBox="0 0 40 40" className="h-8 w-8" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="logo-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="hsl(var(--primary))" />
        <stop offset="100%" stopColor="hsl(var(--teal))" />
      </linearGradient>
    </defs>
    <path d="M20 4L34 12V28L20 36L6 28V12L20 4Z" fill="url(#logo-grad)" opacity="0.9" />
    <path d="M20 10L28 15V25L20 30L12 25V15L20 10Z" fill="white" opacity="0.9" />
    <circle cx="20" cy="20" r="3" fill="url(#logo-grad)" />
  </svg>
);

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const Sidebar: React.FC = () => {
  const {
    sessions,
    currentSessionId,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    pinSession,
    autoRenameFromFirstMessage,
  } = useSession();
  const navigate = useNavigate();
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);

  const sessionItems = useMemo(() => sessions, [sessions]);

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="px-5 pt-6 pb-4">
        <div className="mb-5 flex items-center gap-3">
          <BrandLogo />
          <div className="flex flex-col">
            <span className="font-display text-base font-semibold leading-tight tracking-tight">MyOpenClaw</span>
            <span className="text-[11px] leading-tight text-muted-foreground">AI Agent Workbench</span>
          </div>
        </div>
      </div>

      <div className="px-4 pb-3">
        <button
          onClick={async () => {
            const session = await createSession();
            if (session) navigate(`/s/${session.id}`);
          }}
          className="group flex w-full items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium text-primary-foreground transition-all duration-200"
          style={{
            background: 'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--teal)) 100%)',
            boxShadow: '0 4px 14px -4px hsl(var(--primary) / 0.35)',
          }}
        >
          <MessageSquarePlus className="h-4 w-4 transition-transform group-hover:scale-110" />
          <span>新建会话</span>
          <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-60 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>

      <div className="px-4 pb-2">
        <button
          type="button"
          onClick={() => navigate('/system')}
          className="group flex w-full items-center gap-2.5 rounded-2xl border border-border/60 bg-background/40 px-4 py-2.5 text-sm font-medium text-foreground/80 transition-all duration-200 hover:border-border hover:bg-background/70"
        >
          <ShieldCheck className="h-4 w-4 text-muted-foreground transition-transform group-hover:scale-110" />
          <span>System overview</span>
          <ChevronRight className="ml-auto h-3.5 w-3.5 opacity-60 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>

      <div className="flex items-center justify-between px-5 pt-3 pb-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">最近会话</span>
        <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 pb-3">
        {sessionItems.length === 0 && (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60">
              <Sparkles className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              还没有会话。
              <br />
              点击上方按钮开始。
            </p>
          </div>
        )}

        {sessionItems
          .filter((session) => session.status !== 'closed')
          .map((session) => {
            const isMonitor = isMonitorSession(session.id);
            const monitorIconKey = (session.metadata as { iconKey?: 'qq' | 'feishu' } | undefined)?.iconKey;

            // 渲染左侧图标：监控会话显示对应渠道图标，普通会话显示置顶/消息图标
            const renderIcon = () => {
              if (isMonitor && monitorIconKey === 'qq') {
                return <QQIcon className="h-4 w-4 flex-shrink-0 text-blue-500" />;
              }
              if (isMonitor && monitorIconKey === 'feishu') {
                return <FeishuIcon className="h-4 w-4 flex-shrink-0 text-cyan-500" />;
              }
              if (session.pinnedAt) {
                return <Pin className="h-4 w-4 flex-shrink-0 text-amber-500" />;
              }
              return <MessageSquare className="h-4 w-4 flex-shrink-0 opacity-70" />;
            };

            return (
              <div
                key={session.id}
                className={cn(
                  'relative mx-2 mb-2 rounded-2xl border transition-all duration-200',
                  session.id === currentSessionId
                    ? 'border-primary/25 bg-[linear-gradient(135deg,hsl(var(--primary)_/_0.12)_0%,hsl(var(--teal)_/_0.08)_100%)] shadow-[inset_0_1px_0_hsl(var(--primary)_/_0.08)]'
                    : 'border-transparent hover:bg-muted/45',
                  !isMonitor && session.pinnedAt && session.id !== currentSessionId && 'border-amber-500/20 bg-amber-500/5',
                  isMonitor && session.id !== currentSessionId && 'border-blue-500/15 bg-blue-500/5',
                )}
              >
                <div
                  onClick={() => {
                    switchSession(session.id);
                    navigate(`/s/${session.id}`);
                  }}
                  className="group flex cursor-pointer items-center gap-2.5 px-3.5 py-3"
                >
                  {renderIcon()}

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{session.title || '未命名会话'}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {isMonitor ? (
                        <span className="flex items-center gap-1">
                          <Radio className="h-2.5 w-2.5 animate-pulse text-emerald-500" />
                          <span>实时同步</span>
                        </span>
                      ) : (
                        <>同步于 {formatUpdatedAt(session.updatedAt)}</>
                      )}
                    </div>
                  </div>

                  {!isMonitor && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpenFor(menuOpenFor === session.id ? null : session.id);
                      }}
                      className="rounded-md p-1 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {menuOpenFor === session.id && !isMonitor && (
                  <div className="absolute top-11 right-2 z-20 w-44 rounded-xl border border-border/60 bg-background p-1 shadow-xl">
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted/60"
                      onClick={() => {
                        const next = window.prompt('重命名会话', session.title);
                        if (next !== null) {
                          void renameSession(session.id, next);
                        }
                        setMenuOpenFor(null);
                      }}
                    >
                      <PencilLine className="h-4 w-4" />
                      重命名
                    </button>

                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted/60"
                      onClick={() => {
                        void pinSession(session.id);
                        setMenuOpenFor(null);
                      }}
                    >
                      {session.pinnedAt ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      {session.pinnedAt ? '取消置顶' : '置顶'}
                    </button>

                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-muted/60"
                      onClick={() => {
                        void deleteSession(session.id);
                        setMenuOpenFor(null);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      删除
                    </button>

                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted/60"
                      onClick={() => {
                        void autoRenameFromFirstMessage(session.id);
                        setMenuOpenFor(null);
                      }}
                    >
                      <Sparkles className="h-4 w-4" />
                      首问命名
                    </button>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      <div className="border-t border-border/50 px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-primary">
            <span className="text-[10px] font-bold text-primary-foreground">AI</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[11px] font-medium text-foreground/80">MyOpenClaw</span>
            <span className="text-[10px] text-muted-foreground">v1.1.4</span>
          </div>
        </div>
      </div>
    </div>
  );
};
