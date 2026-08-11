import React, { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import type { ChatMessage } from '@/types/message';

// MessageBubble 内部引用了 react-markdown + react-syntax-highlighter（约 1MB），
// 通过 React.lazy 把 Markdown 链（vendor-md）从首屏切到首条消息渲染时按需加载。
const MessageBubble = lazy(() => import('./MessageBubble'));

interface MessageListProps {
  messages: ChatMessage[];
}

/**
 * Suspense fallback：消息气泡占位骨架
 * 实际场景下 lazy 加载极快（本地 < 50ms），fallback 主要覆盖冷启动 + 弱网
 */
const MessageBubbleFallback: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const isUser = message.role === 'user';
  return (
    <div className="flex items-start gap-3 py-4 animate-fade-in">
      <div className={`h-8 w-8 flex-shrink-0 rounded-xl ${isUser ? 'bg-muted' : 'bg-gradient-primary'}`} />
      <div className="flex-1 min-w-0 space-y-2 mt-2">
        <div className="skeleton-shimmer h-3 rounded-lg w-[60%]" />
        <div className="skeleton-shimmer h-3 rounded-lg w-[85%]" />
        <div className="skeleton-shimmer h-3 rounded-lg w-[40%]" />
      </div>
    </div>
  );
};

/**
 * 列表级 Suspense fallback：仅在所有消息气泡都没加载完成时显示
 * 由于每条消息独立 lazy，单条 fallback 优先
 */
const ListFallback: React.FC = () => (
  <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
    <span>正在加载消息渲染器…</span>
  </div>
);

export const MessageList: React.FC<MessageListProps> = ({ messages }) => {
  if (messages.length === 0) return null;

  return (
    <Suspense fallback={<ListFallback />}>
      <div className="flex flex-col">
        {messages.map((message) => (
          <Suspense key={message.id} fallback={<MessageBubbleFallback message={message} />}>
            <MessageBubble message={message} />
          </Suspense>
        ))}
      </div>
    </Suspense>
  );
};
