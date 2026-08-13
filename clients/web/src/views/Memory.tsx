import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Database,
  Eye,
  Loader2,
  RefreshCw,
  Search as SearchIcon,
  Trash2,
} from 'lucide-react';
import {
  deleteMemorySession,
  deleteMemoryVector,
  fetchMemorySessions,
  fetchMemoryStats,
  searchMemoryVectors,
  type MemorySessionSummary,
  type MemoryStatsResponse,
  type MemoryVectorEntry,
} from '@/api/memory';
import { cn } from '@/utils/cn';

/* ═══════════════════════════════════════════════════════════════
 * 类型 + 工具
 * ═══════════════════════════════════════════════════════════════ */

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type Tab = 'sessions' | 'vectors';

interface DeleteTarget {
  kind: 'session' | 'vector';
  id: string;
  label: string;
  hint?: string;
}

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '-';
  const diff = Date.now() - timestamp;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function formatNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '-';
  return value.toLocaleString();
}

/* ═══════════════════════════════════════════════════════════════
 * 顶部 4 卡片
 * ═══════════════════════════════════════════════════════════════ */

interface MetricCardProps {
  title: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'ok' | 'warn';
}

function MetricCard({ title, value, hint, tone = 'default' }: MetricCardProps) {
  const toneClass =
    tone === 'ok'
      ? 'border-emerald-500/30 bg-emerald-500/5'
      : tone === 'warn'
        ? 'border-amber-500/30 bg-amber-500/5'
        : 'border-border/70 bg-background/60';
  return (
    <div className={cn('rounded-2xl border p-4', toneClass)}>
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground/70">{hint}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
 * 删除确认 Modal (轻量自实现, 不引 Radix Dialog 减体积)
 * ═══════════════════════════════════════════════════════════════ */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-border bg-background p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-rose-500/15 text-rose-300">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-border/70 bg-background px-3 py-1.5 text-sm text-foreground transition hover:bg-muted/60 disabled:opacity-60"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-400 disabled:opacity-60"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
 * 主视图
 * ═══════════════════════════════════════════════════════════════ */

export function Memory() {
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const [stats, setStats] = useState<MemoryStatsResponse | null>(null);
  const [sessions, setSessions] = useState<MemorySessionSummary[]>([]);

  const [tab, setTab] = useState<Tab>('sessions');
  const [sessionFilter, setSessionFilter] = useState('');

  const [vectorQuery, setVectorQuery] = useState('');
  const [vectorTopK, setVectorTopK] = useState(5);
  const [vectorThreshold, setVectorThreshold] = useState(0);
  const [vectorResults, setVectorResults] = useState<MemoryVectorEntry[]>([]);
  const [vectorSearching, setVectorSearching] = useState(false);
  const [vectorError, setVectorError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  /* ── 加载 stats + sessions ──────────────────────────────── */

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const [statsRes, sessionsRes] = await Promise.all([
        fetchMemoryStats(),
        fetchMemorySessions(),
      ]);
      setStats(statsRes);
      setSessions(sessionsRes.sessions);
      setLastUpdated(new Date().toISOString());
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memory data');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ── Sessions 过滤 ──────────────────────────────────────── */

  const filteredSessions = useMemo(() => {
    const q = sessionFilter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.sessionId.toLowerCase().includes(q) ||
        s.userId.toLowerCase().includes(q) ||
        s.channelId.toLowerCase().includes(q) ||
        s.agentId.toLowerCase().includes(q),
    );
  }, [sessions, sessionFilter]);

  /* ── Vectors 搜索 (debounce 300ms) ──────────────────────── */

  useEffect(() => {
    const q = vectorQuery.trim();
    if (!q) {
      setVectorResults([]);
      setVectorError(null);
      return;
    }
    const handle = setTimeout(async () => {
      setVectorSearching(true);
      setVectorError(null);
      try {
        const res = await searchMemoryVectors({
          q,
          topK: vectorTopK,
          threshold: vectorThreshold,
        });
        setVectorResults(res.results);
      } catch (err) {
        setVectorError(err instanceof Error ? err.message : 'Search failed');
        setVectorResults([]);
      } finally {
        setVectorSearching(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [vectorQuery, vectorTopK, vectorThreshold]);

  /* ── 删除 ────────────────────────────────────────────────── */

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      if (deleteTarget.kind === 'session') {
        await deleteMemorySession(deleteTarget.id);
        setSessions((prev) => prev.filter((s) => s.sessionId !== deleteTarget.id));
      } else {
        await deleteMemoryVector(deleteTarget.id);
        setVectorResults((prev) => prev.filter((v) => v.id !== deleteTarget.id));
      }
      // 删完顺手刷 stats
      try {
        const statsRes = await fetchMemoryStats();
        setStats(statsRes);
      } catch {
        // stats 刷新失败不影响主流程
      }
      setDeleteTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteTarget]);

  /* ── 渲染 ────────────────────────────────────────────────── */

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6">

        {/* 标题 */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs text-muted-foreground">
              <Database className="h-3.5 w-3.5" />
              Memory
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Memory management</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Inspect, search, and prune the long-term vector memory and short-term session memory.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
              Last updated: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : '-'}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={state === 'loading'}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-4 text-sm font-medium text-foreground transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={cn('h-4 w-4', state === 'loading' && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        {/* 顶部 4 卡片 */}
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Active sessions"
            value={formatNumber(stats?.sessions.active)}
            hint={stats ? `${formatNumber(sessions.length)} loaded` : 'Loading'}
          />
          <MetricCard
            title="Vector entries"
            value={formatNumber(stats?.vectors.total)}
            hint={stats ? `${stats.embedding.dimension}-dim` : 'Loading'}
          />
          <MetricCard
            title="Embedding"
            value={stats ? stats.embedding.provider : '-'}
            hint={
              stats
                ? `${stats.embedding.dimension}-dim · ${stats.embedding.available ? 'API ready' : 'keyword fallback'}`
                : 'Loading'
            }
            tone={stats?.embedding.available === false ? 'warn' : 'default'}
          />
          <MetricCard
            title="Last refresh"
            value={state === 'loading' ? 'Loading…' : state === 'ready' ? 'Just now' : '-'}
            hint="Manual cleanup runs in v1.1.8"
          />
        </section>

        {/* Tab 主体 */}
        <section className="rounded-2xl border border-border/70 bg-background/60">

          {/* Tab 头 */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4">
            <div role="tablist" className="flex gap-1">
              <button
                role="tab"
                aria-selected={tab === 'sessions'}
                onClick={() => setTab('sessions')}
                className={cn(
                  'border-b-2 px-4 py-3 text-sm font-medium transition',
                  tab === 'sessions'
                    ? 'border-emerald-400 text-emerald-300'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                Sessions
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {formatNumber(sessions.length)}
                </span>
              </button>
              <button
                role="tab"
                aria-selected={tab === 'vectors'}
                onClick={() => setTab('vectors')}
                className={cn(
                  'border-b-2 px-4 py-3 text-sm font-medium transition',
                  tab === 'vectors'
                    ? 'border-emerald-400 text-emerald-300'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                Vectors
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {formatNumber(stats?.vectors.total)}
                </span>
              </button>
            </div>

            {tab === 'sessions' ? (
              <div className="flex items-center gap-2 py-2">
                <input
                  value={sessionFilter}
                  onChange={(e) => setSessionFilter(e.target.value)}
                  placeholder="Filter by id / user / channel…"
                  className="h-9 w-72 rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-400/50 focus:outline-none"
                />
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 py-2">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={vectorQuery}
                    onChange={(e) => setVectorQuery(e.target.value)}
                    placeholder="Semantic search…"
                    className="h-9 w-72 rounded-lg border border-border/70 bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-emerald-400/50 focus:outline-none"
                  />
                </div>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  topK
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={vectorTopK}
                    onChange={(e) => setVectorTopK(Math.max(1, Math.min(50, Number(e.target.value) || 5)))}
                    className="h-7 w-14 rounded border border-border/70 bg-background px-1.5 text-center text-xs text-foreground"
                  />
                </label>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  threshold
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={vectorThreshold}
                    onChange={(e) => setVectorThreshold(Math.max(0, Math.min(1, Number(e.target.value) || 0)))}
                    className="h-7 w-16 rounded border border-border/70 bg-background px-1.5 text-center text-xs text-foreground"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Tab body: Sessions */}
          {tab === 'sessions' && (
            <div>
              {state === 'loading' && sessions.length === 0 ? (
                <div className="divide-y divide-border/50">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="grid grid-cols-12 gap-3 px-4 py-3">
                      <div className="col-span-3 h-4 animate-pulse rounded bg-muted" />
                      <div className="col-span-2 h-4 animate-pulse rounded bg-muted" />
                      <div className="col-span-2 h-4 animate-pulse rounded bg-muted" />
                      <div className="col-span-2 h-4 animate-pulse rounded bg-muted" />
                      <div className="col-span-2 h-4 animate-pulse rounded bg-muted" />
                      <div className="col-span-1 h-4 animate-pulse rounded bg-muted" />
                    </div>
                  ))}
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                  {sessions.length === 0
                    ? 'No sessions yet. They will appear here as your agents create them.'
                    : 'No sessions match the current filter.'}
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  <div className="grid grid-cols-12 gap-3 px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground/70">
                    <div className="col-span-3">Session</div>
                    <div className="col-span-2">User</div>
                    <div className="col-span-2">Channel / Agent</div>
                    <div className="col-span-2">Messages</div>
                    <div className="col-span-2">Last active</div>
                    <div className="col-span-1 text-right">Actions</div>
                  </div>
                  {filteredSessions.map((session) => {
                    const isStale = Date.now() - session.lastActiveAt > 24 * 60 * 60 * 1000;
                    return (
                      <div
                        key={session.sessionId}
                        className="grid grid-cols-12 items-center gap-3 px-4 py-3 text-sm transition hover:bg-muted/30"
                      >
                        <div className="col-span-3">
                          <div className="font-mono text-foreground">{session.sessionId}</div>
                          <div
                            className={cn(
                              'text-[11px]',
                              isStale ? 'text-amber-400/90' : 'text-muted-foreground/60',
                            )}
                          >
                            {isStale
                              ? `idle ${formatRelativeTime(session.lastActiveAt)} · candidate for cleanup`
                              : `created ${formatRelativeTime(session.createdAt)}`}
                          </div>
                        </div>
                        <div className="col-span-2 truncate text-foreground/80">
                          {session.userId}
                        </div>
                        <div className="col-span-2 truncate text-foreground/80">
                          {session.channelId} / {session.agentId}
                        </div>
                        <div className="col-span-2 text-foreground/80">
                          {formatNumber(session.messageCount)}
                        </div>
                        <div className="col-span-2 text-muted-foreground">
                          {formatRelativeTime(session.lastActiveAt)}
                        </div>
                        <div className="col-span-1 flex justify-end gap-1">
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                            title="View (v1.1.8)"
                            disabled
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-rose-300/80 transition hover:bg-rose-500/15 hover:text-rose-200"
                            title="Delete"
                            onClick={() =>
                              setDeleteTarget({
                                kind: 'session',
                                id: session.sessionId,
                                label: session.sessionId,
                                hint: `${formatNumber(session.messageCount)} messages · user ${session.userId}`,
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab body: Vectors */}
          {tab === 'vectors' && (
            <div>
              {vectorError && (
                <div className="m-4 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                  {vectorError}
                </div>
              )}

              {vectorQuery.trim() === '' ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                  Type a query above to search across the long-term memory.
                </div>
              ) : vectorSearching && vectorResults.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  <p className="mt-2">Searching…</p>
                </div>
              ) : vectorResults.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                  No matches for &ldquo;{vectorQuery}&rdquo;.
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {vectorResults.map((entry) => (
                    <div key={entry.id} className="grid grid-cols-12 gap-3 px-4 py-3 text-sm">
                      <div className="col-span-2 truncate font-mono text-xs text-muted-foreground/80">
                        {entry.id.slice(0, 12)}
                      </div>
                      <div className="col-span-7">
                        <p className="line-clamp-2 text-foreground/90">{entry.content}</p>
                        <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                          {entry.metadata?.type && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">
                              {String(entry.metadata.type)}
                            </span>
                          )}
                          {entry.metadata?.sessionId && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">
                              session: {String(entry.metadata.sessionId)}
                            </span>
                          )}
                          {entry.metadata?.importance !== undefined && (
                            <span className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">
                              importance: {String(entry.metadata.importance)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="col-span-2 text-xs text-muted-foreground">
                        {entry.score !== undefined ? `score: ${entry.score.toFixed(3)}` : '-'}
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-rose-300/80 transition hover:bg-rose-500/15 hover:text-rose-200"
                          title="Delete"
                          onClick={() =>
                            setDeleteTarget({
                              kind: 'vector',
                              id: entry.id,
                              label: entry.id.slice(0, 12),
                              hint: entry.content.slice(0, 80),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <ConfirmDialog
          open={deleteTarget !== null}
          title={
            deleteTarget?.kind === 'session'
              ? `Delete session ${deleteTarget?.label}?`
              : `Delete vector ${deleteTarget?.label}?`
          }
          description={
            deleteTarget?.kind === 'session'
              ? `This will remove the session memory. ${deleteTarget?.hint ?? ''}. Vector entries referencing this session will be detached. This cannot be undone.`
              : `This will remove the vector entry from long-term memory. ${deleteTarget?.hint ?? ''}. This cannot be undone.`
          }
          busy={deleteBusy}
          onCancel={() => !deleteBusy && setDeleteTarget(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      </div>
    </div>
  );
}
