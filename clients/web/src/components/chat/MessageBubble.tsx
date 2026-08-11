import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import {
  Wrench,
  AlertCircle,
  FileText,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  BrainCircuit,
  UserCircle2,
  Send,
  Users,
} from 'lucide-react';
import type { ChatMessage, ExternalSourceInfo } from '@/types/message';

interface MessageBubbleProps {
  message: ChatMessage;
}

const JARVIS_AVATAR = '/avatars/jarvis.png';
const USER_AVATAR = '/avatars/user.png';

function normalizeMessageText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  const finalMatch = trimmed.match(/<final_answer>([\s\S]*?)<\/final_answer>/i);
  if (finalMatch) {
    return finalMatch[1].trim();
  }

  return trimmed
    .replace(/^<final_answer>\s*/i, '')
    .replace(/\s*<\/final_answer>$/i, '')
    .trim();
}

const UserAvatar: React.FC = () => (
  <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-xl border border-border/50 bg-muted shadow-sm">
    <img src={USER_AVATAR} alt="用户" className="h-full w-full object-cover" loading="lazy" />
  </div>
);

const AssistantAvatar: React.FC = () => (
  <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded-xl border border-border/50 bg-muted shadow-sm">
    <img src={JARVIS_AVATAR} alt="Jarvis" className="h-full w-full object-cover" loading="lazy" />
  </div>
);

const ToolAvatar: React.FC = () => (
  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10">
    <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400" />
  </div>
);

const markdownComponents: Components = {
  pre(props) {
    return <>{props.children}</>;
  },
  code(props) {
    const className = props.className ?? '';
    const match = /language-(\w+)/.exec(className);
    const isInline = !match && !String(props.children).includes('\n');

    if (isInline) {
      return <code className="rounded-md bg-muted/50 px-1.5 py-0.5 text-xs font-mono">{props.children}</code>;
    }

    const language = match ? match[1] : 'text';
    const codeText = String(props.children).replace(/\n$/, '');

    return (
      <SyntaxHighlighter
        language={language}
        style={atomOneDark}
        customStyle={{
          margin: '0.75rem 0',
          padding: '1rem',
          borderRadius: '0.75rem',
          fontSize: '0.75rem',
          background: 'hsl(var(--muted) / 0.5)',
          border: '1px solid hsl(var(--border) / 0.5)',
        }}
        wrapLongLines
        showLineNumbers={codeText.split('\n').length > 5}
      >
        {codeText}
      </SyntaxHighlighter>
    );
  },
  table(props) {
    return (
      <div className="my-3 overflow-x-auto rounded-xl border border-border/50">
        <table className="w-full border-collapse text-xs">{props.children}</table>
      </div>
    );
  },
  thead(props) {
    return <thead className="bg-muted/50 font-semibold">{props.children}</thead>;
  },
  th(props) {
    return <th className="border border-border/50 px-3 py-2 text-left">{props.children}</th>;
  },
  td(props) {
    return <td className="border border-border/50 px-3 py-2">{props.children}</td>;
  },
  tbody(props) {
    return <tbody className="[&>tr:nth-child(odd)]:bg-muted/30">{props.children}</tbody>;
  },
  blockquote(props) {
    return <blockquote className="my-3 border-l-4 border-primary/40 pl-4 italic text-muted-foreground">{props.children}</blockquote>;
  },
  a(props) {
    return (
      <a
        href={props.href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 transition-colors hover:text-primary/80"
      >
        {props.children}
      </a>
    );
  },
  ul(props) {
    return <ul className="my-2 list-disc space-y-1 pl-5">{props.children}</ul>;
  },
  ol(props) {
    return <ol className="my-2 list-decimal space-y-1 pl-5">{props.children}</ol>;
  },
  li(props) {
    return <li className="marker:text-muted-foreground">{props.children}</li>;
  },
  h1(props) {
    return <h1 className="mb-2 mt-4 font-display text-xl font-bold">{props.children}</h1>;
  },
  h2(props) {
    return <h2 className="mb-2 mt-4 font-display text-lg font-bold">{props.children}</h2>;
  },
  h3(props) {
    return <h3 className="mb-1.5 mt-3 font-display text-base font-semibold">{props.children}</h3>;
  },
  p(props) {
    return <p className="my-2">{props.children}</p>;
  },
  hr() {
    return <hr className="my-4 border-border/50" />;
  },
};

/**
 * 渲染外部渠道来源标签
 *
 * 监控会话中的用户消息会显示"来自 QQ 用户: xxx"标签，区分不同用户的对话
 * Web 端反向推送的助手消息显示"已通过 Web 推送"标签
 */
function renderExternalSourceLabel(source: ExternalSourceInfo): React.ReactNode {
  if (!source.sourceChannel) return null;

  // Web 端反向推送的助手消息
  if (source.fromWebMonitor) {
    return (
      <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <Send className="h-3 w-3" />
        <span>已通过 Web 推送</span>
      </div>
    );
  }

  // 外部渠道用户消息
  const channelLabel = source.sourceChannel === 'qqbot' ? 'QQ' : source.sourceChannel === 'feishu' ? '飞书' : source.sourceChannel;
  const isGroup = source.chatType === 'group';
  const userLabel = source.sourceDisplayName ?? source.sourceUsername ?? (source.sourceUserId ? source.sourceUserId.slice(0, 8) : '未知用户');

  return (
    <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
      {isGroup ? (
        <>
          <Users className="h-3 w-3" />
          <span>来自 {channelLabel} 群{source.groupName ? `:${source.groupName}` : ''} - {userLabel}</span>
        </>
      ) : (
        <>
          <UserCircle2 className="h-3 w-3" />
          <span>来自 {channelLabel} 用户: {userLabel}</span>
        </>
      )}
    </div>
  );
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const { role, content, status, externalSource } = message;
  const isUser = role === 'user';
  const isError = status === 'error';
  const [reasoningOpen, setReasoningOpen] = React.useState(false);
  const displayName = isUser ? '用户' : role === 'assistant' ? '贾维斯' : role === 'tool' ? '工具' : '系统';
  const reasoning = message.reasoning?.trim();

  const renderAvatar = () => {
    switch (role) {
      case 'user':
        return <UserAvatar />;
      case 'assistant':
        return <AssistantAvatar />;
      case 'tool':
        return <ToolAvatar />;
      default:
        return <AssistantAvatar />;
    }
  };

  const renderContent = () =>
    content.map((block, index) => {
      switch (block.type) {
        case 'text':
          return (
            <div key={index} className="break-words whitespace-pre-wrap text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {normalizeMessageText(block.text)}
              </ReactMarkdown>
            </div>
          );
        case 'image':
          return <img key={index} src={block.url} alt="图片" className="mt-3 max-w-full rounded-xl shadow-sm" loading="lazy" />;
        case 'file':
          return (
            <a
              key={index}
              href={block.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 flex items-center gap-3 rounded-xl border border-border/40 bg-muted/30 p-3 text-sm transition-colors hover:bg-muted/50"
            >
              <FileText className="h-4 w-4 flex-shrink-0 text-primary" />
              <div className="min-w-0">
                <div className="truncate font-medium">{block.name}</div>
                <div className="text-xs text-muted-foreground">{(block.size / 1024).toFixed(1)} KB · {block.mimeType}</div>
              </div>
            </a>
          );
        case 'code':
          return (
            <div key={index} className="relative my-3">
              <div className="flex items-center justify-between rounded-t-xl border border-b-0 border-border bg-muted/50 px-4 py-2">
                <span className="text-xs font-mono text-muted-foreground">{block.language || 'code'}</span>
              </div>
              <SyntaxHighlighter
                language={block.language || 'text'}
                style={atomOneDark}
                customStyle={{
                  margin: 0,
                  padding: '1rem',
                  borderTopLeftRadius: 0,
                  borderTopRightRadius: 0,
                  borderBottomLeftRadius: '0.75rem',
                  borderBottomRightRadius: '0.75rem',
                  fontSize: '0.75rem',
                  background: 'hsl(var(--muted) / 0.5)',
                  border: '1px solid hsl(var(--border) / 0.5)',
                  borderTop: 'none',
                }}
                wrapLongLines
                showLineNumbers={block.code.split('\n').length > 5}
              >
                {block.code}
              </SyntaxHighlighter>
            </div>
          );
        case 'tool_call':
          return (
            <div key={index} className="mt-3 animate-fade-in rounded-xl border border-dashed border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <div className="mb-1.5 flex items-center gap-2 font-semibold text-amber-600 dark:text-amber-400">
                <Wrench className="h-3.5 w-3.5" />
                <span>调用工具: {block.toolName}</span>
              </div>
              <pre className="overflow-x-auto font-mono text-muted-foreground">{JSON.stringify(block.arguments, null, 2)}</pre>
            </div>
          );
        case 'tool_result':
          return (
            <div
              key={index}
              className={
                'mt-3 animate-fade-in rounded-xl border border-dashed p-3 text-xs ' +
                (block.success ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')
              }
            >
              <div className={'mb-1.5 flex items-center gap-2 font-semibold ' + (block.success ? 'text-emerald-600' : 'text-red-600')}>
                {block.success ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                <span>工具结果: {block.toolName}</span>
              </div>
              <pre className="overflow-x-auto font-mono text-muted-foreground">
                {typeof block.result === 'string' ? block.result : JSON.stringify(block.result, null, 2)}
              </pre>
            </div>
          );
        default:
          return null;
      }
    });

  return (
    <div className={'group flex gap-4 py-5 ' + (isUser ? 'flex-row-reverse' : 'flex-row')}>
      {isError ? (
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-red-500/20 bg-red-500/10">
          <AlertCircle className="h-4 w-4 text-red-500" />
        </div>
      ) : (
        renderAvatar()
      )}

      <div className={'flex max-w-[88%] flex-col ' + (isUser ? 'items-end' : 'items-start')}>
        <div className={'mb-1 px-1 text-[11px] font-medium text-muted-foreground ' + (isUser ? 'text-right' : 'text-left')}>
          {displayName}
        </div>

        {externalSource && renderExternalSourceLabel(externalSource)}

        {role === 'assistant' && reasoning && (
          <div className="mb-2 w-full max-w-full">
            <button
              type="button"
              onClick={() => setReasoningOpen((value) => !value)}
              className="flex items-center gap-2 px-1 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {reasoningOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <BrainCircuit className="h-3.5 w-3.5" />
              <span>思考过程</span>
              {typeof message.reasoningDurationMs === 'number' && (
                <span className="opacity-70">· {Math.max(1, Math.round(message.reasoningDurationMs / 1000))}s</span>
              )}
            </button>
            {reasoningOpen && (
              <div className="mt-2 whitespace-pre-wrap rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                {reasoning}
              </div>
            )}
          </div>
        )}

        <div
          className={
            (isUser ? 'message-bubble-user' : 'message-bubble-assistant') +
            (status === 'streaming' ? ' message-bubble-streaming' : '') +
            (isError ? ' border-red-500/30 ring-1 ring-red-500/20' : '')
          }
        >
          {renderContent()}
        </div>

        <div className={'mt-1.5 flex items-center gap-2 px-1 text-xs ' + (isUser ? 'flex-row-reverse' : 'flex-row')}>
          {message.timestamp && (
            <span className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
              {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {status === 'sending' && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />发送中...
            </span>
          )}
          {status === 'sent' && <span className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">已发送</span>}
          {status === 'error' && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3 w-3" />
              {message.error || '发送失败'}
            </span>
          )}
          {status === 'streaming' && (
            <span className="flex animate-pulse items-center gap-1 text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />生成中...
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
