import React from 'react';
import { Database, RefreshCw, AlertCircle } from 'lucide-react';
import { getMemorySession, type MemorySessionDetail } from '@/api/memory';
import { cn } from '@/utils/cn';

interface MemoryInspectorProps {
  sessionId?: string | null;
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString();
}

export const MemoryInspector: React.FC<MemoryInspectorProps> = ({ sessionId }) => {
  const [data, setData] = React.useState<MemorySessionDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!sessionId) {
      setData(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const detail = await getMemorySession(sessionId);
      setData(detail);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : '无法读取 memory 会话');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/50 bg-background/60 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Database className="h-4 w-4 text-primary" />
            <span>Memory 会话诊断</span>
          </div>
          <p className="mt-1 break-all text-xs leading-relaxed text-muted-foreground">
            当前会话 ID: {sessionId || '未选择会话'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={!sessionId || loading}
          className={cn(
            'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors',
            !sessionId || loading
              ? 'cursor-not-allowed border-border/40 text-muted-foreground/60'
              : 'border-border/60 text-foreground hover:bg-muted/50',
          )}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          刷新
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-600 dark:text-red-300">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" />
            <span>读取失败</span>
          </div>
          <p className="mt-2 break-words text-xs leading-relaxed">{error}</p>
        </div>
      )}

      {data && (
        <>
          <div className="space-y-3 rounded-2xl border border-border/50 bg-background/60 p-4">
            <div className="grid grid-cols-1 gap-3 text-xs text-muted-foreground">
              <div>
                <div className="font-medium text-foreground">用户</div>
                <div className="mt-1 break-all">{data.userId}</div>
              </div>
              <div>
                <div className="font-medium text-foreground">通道</div>
                <div className="mt-1 break-all">{data.channelId}</div>
              </div>
              <div>
                <div className="font-medium text-foreground">Agent</div>
                <div className="mt-1 break-all">{data.agentId}</div>
              </div>
              <div>
                <div className="font-medium text-foreground">消息数</div>
                <div className="mt-1">{data.metadata?.messageCount ?? '--'}</div>
              </div>
              <div>
                <div className="font-medium text-foreground">创建时间</div>
                <div className="mt-1">{data.metadata?.createdAt ? formatTime(data.metadata.createdAt) : '--'}</div>
              </div>
              <div>
                <div className="font-medium text-foreground">最近活跃</div>
                <div className="mt-1">{data.metadata?.lastActiveAt ? formatTime(data.metadata.lastActiveAt) : '--'}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/50 bg-background/60 p-4">
            <div className="mb-3 text-sm font-medium text-foreground">最近消息</div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {(data.messages ?? []).slice(-8).map((message) => (
                <div key={message.id} className="rounded-xl bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                    <span className="uppercase tracking-wide">{message.role}</span>
                    <span>{formatTime(message.timestamp)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
                    {message.content || '(空内容)'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!data && !error && !loading && sessionId && (
        <div className="rounded-2xl border border-dashed border-border/50 bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground">
          当前后端 memory 中还没有找到该会话，通常表示消息尚未写入、网关尚未绑定真实 runtime，或者读取的是另一套会话系统。
        </div>
      )}
    </div>
  );
};
