import React from 'react';
import { MessageCircle, Code, Zap, Sparkles, Radio, Info } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import { useAutoScroll } from '@/hooks/useAutoScroll';
import { useSessionStore } from '@/stores/useSessionStore';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import { TypingIndicator } from './TypingIndicator';
import { isMonitorSession, getMonitorSessionConfig } from '@/config/sync-defaults';

interface ChatContainerProps {
  sessionId: string;
}

const EmptyStateIllustration: React.FC = () => (
  <svg viewBox="0 0 200 160" className="mx-auto h-40 w-48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="empty-grad" x1="0" y1="0" x2="200" y2="160" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="hsl(var(--primary) / 0.15)" />
        <stop offset="100%" stopColor="hsl(var(--teal) / 0.1)" />
      </linearGradient>
      <linearGradient id="empty-icon-grad" x1="0" y1="0" x2="60" y2="60" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="hsl(var(--primary))" />
        <stop offset="100%" stopColor="hsl(var(--teal))" />
      </linearGradient>
    </defs>
    <ellipse cx="100" cy="120" rx="70" ry="8" fill="hsl(var(--muted))" opacity="0.5" />
    <path d="M40 60C40 38 58 20 80 20H120C142 20 160 38 160 60V90C160 112 142 130 120 130H80C58 130 40 112 40 90V60Z" fill="url(#empty-grad)" />
    <circle cx="100" cy="75" r="28" fill="url(#empty-icon-grad)" opacity="0.9" />
    <path d="M100 62L106 72H94L100 62Z M100 88L94 78H106L100 88Z" fill="white" opacity="0.9" />
    <circle cx="65" cy="55" r="3" fill="hsl(var(--primary))" opacity="0.6" />
    <circle cx="140" cy="50" r="2" fill="hsl(var(--teal))" opacity="0.6" />
    <circle cx="50" cy="85" r="2" fill="hsl(var(--accent))" opacity="0.5" />
    <circle cx="155" cy="95" r="3" fill="hsl(var(--lavender))" opacity="0.5" />
  </svg>
);

const QuickSuggestion: React.FC<{ icon: React.ReactNode; label: string; desc: string; onClick: () => void }> = ({
  icon,
  label,
  desc,
  onClick,
}) => (
  <button
    onClick={onClick}
    className="group flex min-h-[92px] items-start gap-3 rounded-2xl border border-border/50 bg-card/45 px-4 py-4 text-left transition-all duration-300 hover:border-primary/30 hover:bg-card/75"
  >
    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground transition-transform group-hover:scale-110">
      {icon}
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</div>
    </div>
  </button>
);

export const ChatContainer: React.FC<ChatContainerProps> = ({ sessionId }) => {
  const { messages, isSending, sendMessage, streamingReasoning, streamingContent } = useChat(sessionId);
  const { containerRef, handleScroll } = useAutoScroll([messages]);
  const lastSyncedSessionId = useSessionStore((state) => state.lastSyncedSessionId);
  const lastSyncedAt = useSessionStore((state) => state.lastSyncedAt);

  // 监控会话标识：用于切换 UI 提示文案、占位符等
  const isMonitor = isMonitorSession(sessionId);
  const monitorConfig = getMonitorSessionConfig(sessionId);
  const channelLabel = monitorConfig?.monitorChannel === 'qqbot' ? 'QQ' : monitorConfig?.monitorChannel === 'feishu' ? '飞书' : '外部';

  const handleSend = async (content: string, files?: File[]) => {
    if (!content.trim() && (!files || files.length === 0)) return;
    await sendMessage(content, files);
  };

  const quickSuggestions = [
    { icon: <MessageCircle className="h-4 w-4" />, label: '解释概念', desc: '帮我详细解释某个技术概念' },
    { icon: <Code className="h-4 w-4" />, label: '代码助手', desc: '生成、重构或调试代码' },
    { icon: <Zap className="h-4 w-4" />, label: '任务规划', desc: '帮助拆解复杂任务并制定计划' },
    { icon: <Sparkles className="h-4 w-4" />, label: '创意探索', desc: '头脑风暴和创意发散' },
  ];

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div ref={containerRef} onScroll={handleScroll} className="scrollbar-thin flex-1 overflow-y-auto px-4 md:px-6 xl:px-8">
        <div className="mx-auto w-full max-w-[1120px] py-7 md:py-10 xl:py-12">
          {isMonitor && (
            <div className="mb-6 flex items-start gap-3 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-xs">
              <Radio className="mt-0.5 h-4 w-4 flex-shrink-0 animate-pulse text-blue-500" />
              <div className="leading-relaxed text-muted-foreground">
                <div className="mb-1 font-medium text-foreground">{channelLabel}机器人对话同步窗口</div>
                <div>这里实时显示 {channelLabel} 端用户给机器人发的消息，以及机器人的回复。</div>
                <div className="mt-1.5 flex items-start gap-1.5">
                  <Info className="mt-0.5 h-3 w-3 flex-shrink-0" />
                  <span>从这里发送消息会推送给最近一个活跃的 {channelLabel} 用户。如果没有活跃用户，请等待 {channelLabel} 端先发消息后再回复。</span>
                </div>
              </div>
            </div>
          )}

          {messages.length === 0 && !isMonitor && (
            <div className="flex min-h-[70vh] flex-col items-center justify-center py-10 md:min-h-[72vh] md:-translate-y-6">
              <EmptyStateIllustration />
              <h2 className="mt-5 mb-2 text-2xl font-display font-semibold tracking-tight text-foreground md:text-[30px]">
                开始与 <span className="text-gradient">Jarvis</span> 对话
              </h2>
              <p className="mb-12 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground md:text-[15px]">
                我可以帮你完成代码编写、任务规划、知识问答等各种工作。
                <br />
                选择一个方向开始，或者直接输入你的问题。
              </p>

              <div className="grid w-full max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2 xl:gap-4">
                {quickSuggestions.map((suggestion) => (
                  <QuickSuggestion
                    key={suggestion.label}
                    icon={suggestion.icon}
                    label={suggestion.label}
                    desc={suggestion.desc}
                    onClick={() => handleSend(suggestion.desc)}
                  />
                ))}
              </div>
            </div>
          )}

          <MessageList messages={messages} />

          {isSending && !isMonitor && <TypingIndicator reasoning={streamingReasoning} streamingContent={streamingContent} />}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-border/45 bg-background/22 px-4 py-6 backdrop-blur-md md:px-6 xl:px-8">
        <div className="mx-auto w-full max-w-[1080px]">
          {lastSyncedSessionId === sessionId && lastSyncedAt && (
            <div className="mb-2 text-[11px] text-muted-foreground">
              历史已加载 {new Date(lastSyncedAt).toLocaleTimeString()}
            </div>
          )}
          <div className="rounded-[24px] border border-border/60 bg-card/58 p-2.5 shadow-[0_24px_60px_-40px_rgba(0,0,0,0.7)] backdrop-blur-xl">
            <MessageInput
              onSend={handleSend}
              disabled={isSending}
              placeholder={
                isMonitor
                  ? `输入消息，将推送给最近活跃的 ${channelLabel} 用户（按 Enter 发送）...`
                  : '输入消息，按 Enter 发送，Shift+Enter 换行...'
              }
            />
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            {isMonitor
              ? `消息将作为机器人主动消息发送给 ${channelLabel} 用户，可能受渠道频控限制`
              : 'MyOpenClaw 可能会生成不准确的信息，请核实重要内容。'}
          </p>
        </div>
      </div>
    </div>
  );
};
