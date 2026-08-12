import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock3,
  Cpu,
  Gauge,
  HardDrive,
  HeartPulse,
  PlugZap,
  RefreshCw,
  Server,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { fetchSkills, fetchTools } from '@/api/skills';
import { fetchAgents, fetchHealth, fetchSchedulerTasks, fetchSystemStatus } from '@/api/system';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface DashboardData {
  health: Awaited<ReturnType<typeof fetchHealth>>;
  status: Awaited<ReturnType<typeof fetchSystemStatus>>;
  agents: Awaited<ReturnType<typeof fetchAgents>>;
  tools: Awaited<ReturnType<typeof fetchTools>>;
  skills: Awaited<ReturnType<typeof fetchSkills>>;
  scheduler: Awaited<ReturnType<typeof fetchSchedulerTasks>>;
}

const BUILTIN_TOOL_TARGET = 28;
const CHANNEL_TARGET = ['qqbot', 'feishu', 'wechat'];

function formatUptime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '-';
  }

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) {
    return '-';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
}

function formatDate(value?: string): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function statusTone(ok: boolean): string {
  return ok
    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
    : 'border-rose-500/25 bg-rose-500/10 text-rose-200';
}

export function SystemOverview() {
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const load = async () => {
    setState('loading');
    setError(null);

    try {
      const [health, status, agents, tools, skills, scheduler] = await Promise.all([
        fetchHealth(),
        fetchSystemStatus(),
        fetchAgents(),
        fetchTools(),
        fetchSkills(),
        fetchSchedulerTasks(),
      ]);

      setData({ health, status, agents, tools, skills, scheduler });
      setLastUpdated(new Date().toISOString());
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load system overview');
      setState('error');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const summary = useMemo(() => {
    if (!data) {
      return null;
    }

    const builtinToolGap = BUILTIN_TOOL_TARGET - data.tools.total;
    const activeAgents = data.agents.agents.filter((agent) => agent.status === 'ready').length;

    return {
      healthOk: data.health.status === 'healthy',
      toolsOk: data.tools.total >= BUILTIN_TOOL_TARGET,
      builtinToolGap,
      activeAgents,
      channelsSeen: data.status.channels,
      schedulerTasks: data.scheduler.total,
      skillsLoaded: data.skills.total,
    };
  }, [data]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              System overview
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">Runtime health and capability snapshot</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                A quick read on gateway health, registered capabilities, and the current integration baseline.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-border/70 bg-background/50 px-3 py-2 text-xs text-muted-foreground">
              Last updated: {lastUpdated ? formatDate(lastUpdated) : '-'}
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={state === 'loading'}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-4 text-sm font-medium text-foreground transition hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${state === 'loading' ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Gateway health"
            value={summary?.healthOk ? 'Healthy' : 'Needs attention'}
            hint={data ? `Status: ${data.health.status}` : 'Loading'}
            icon={HeartPulse}
            tone={summary ? statusTone(summary.healthOk) : 'border-border/70 bg-background/60 text-foreground'}
          />
          <MetricCard
            title="Built-in tools"
            value={data ? `${data.tools.total}` : '-'}
            hint={
              summary
                ? summary.toolsOk
                  ? `Baseline met (${BUILTIN_TOOL_TARGET})`
                  : `${summary.builtinToolGap} short of baseline ${BUILTIN_TOOL_TARGET}`
                : 'Loading'
            }
            icon={Wrench}
            tone={
              summary
                ? statusTone(summary.toolsOk)
                : 'border-border/70 bg-background/60 text-foreground'
            }
          />
          <MetricCard
            title="Registered skills"
            value={data ? `${data.skills.total}` : '-'}
            hint={data ? 'Loaded from skill registry' : 'Loading'}
            icon={Bot}
            tone="border-border/70 bg-background/60 text-foreground"
          />
          <MetricCard
            title="Scheduler tasks"
            value={data ? `${data.scheduler.total}` : '-'}
            hint={data ? 'Active scheduled jobs' : 'Loading'}
            icon={Clock3}
            tone="border-border/70 bg-background/60 text-foreground"
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <section className="rounded-2xl border border-border/70 bg-background/40 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Core runtime</h2>
                <p className="text-sm text-muted-foreground">Live state reported by the gateway status endpoints.</p>
              </div>
              <Server className="h-5 w-5 text-muted-foreground" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <KeyValueCard icon={Activity} label="Runtime status" value={data?.status.status ?? '-'} />
              <KeyValueCard icon={Gauge} label="Uptime" value={data ? formatUptime(data.status.uptime) : '-'} />
              <KeyValueCard
                icon={PlugZap}
                label="Connections"
                value={data ? `${data.status.connectionCount} / ${data.status.maxConnections}` : '-'}
              />
              <KeyValueCard icon={Cpu} label="Active sessions" value={data ? `${data.status.activeSessions}` : '-'} />
              <KeyValueCard icon={Bot} label="Ready agents" value={summary ? `${summary.activeAgents}` : '-'} />
              <KeyValueCard icon={HardDrive} label="RSS memory" value={formatBytes(data?.status.memoryUsage?.rss)} />
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-card/50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">Deployment facts</h3>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                </div>
                <dl className="space-y-2 text-sm">
                  <FactRow label="Version" value={data?.status.version ?? '-'} />
                  <FactRow
                    label="Endpoint"
                    value={data ? `${data.status.host}:${data.status.port}` : '-'}
                  />
                  <FactRow label="Rules" value={data ? `${data.status.ruleCount}` : '-'} />
                  <FactRow label="Server time" value={data ? formatDate(data.status.serverTime) : '-'} />
                </dl>
              </div>

              <div className="rounded-xl border border-border/70 bg-card/50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">Capability matrix</h3>
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="space-y-2">
                  <CapabilityRow
                    label="HTTP + WebSocket gateway"
                    ok={Boolean(data?.status.status)}
                    detail={data ? data.status.status : 'Unavailable'}
                  />
                  <CapabilityRow
                    label="Channels baseline"
                    ok={Boolean(data && data.status.channels >= CHANNEL_TARGET.length)}
                    detail={data ? `${data.status.channels} channel states visible` : 'Unavailable'}
                  />
                  <CapabilityRow
                    label="Tool registry baseline"
                    ok={Boolean(summary?.toolsOk)}
                    detail={data ? `${data.tools.total} tools registered` : 'Unavailable'}
                  />
                  <CapabilityRow
                    label="Skill registry"
                    ok={Boolean(data && data.skills.total > 0)}
                    detail={data ? `${data.skills.total} skills loaded` : 'Unavailable'}
                  />
                  <CapabilityRow
                    label="Task scheduler"
                    ok={Boolean(data)}
                    detail={data ? `${data.scheduler.total} task records` : 'Unavailable'}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border/70 bg-background/40 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Integration focus</h2>
                <p className="text-sm text-muted-foreground">A tiny scoreboard for what is already present and what still needs work.</p>
              </div>
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            </div>

            <div className="space-y-3">
              <CapabilityPill
                title="Channels"
                description="QQ, Feishu, and WeChat registrations are already in the runtime baseline."
                ok={Boolean(data && data.status.channels >= CHANNEL_TARGET.length)}
              />
              <CapabilityPill
                title="CLI diagnostics"
                description="The new doctor command can now verify gateway reachability, workspace paths, and runtime prerequisites."
                ok
              />
              <CapabilityPill
                title="System visibility"
                description="This page surfaces health, counts, and capability coverage without checking logs first."
                ok
              />
              <CapabilityPill
                title="OpenClaw parity gap"
                description={
                  summary && summary.builtinToolGap > 0
                    ? `Tool baseline still trails the current 28-tool target by ${summary.builtinToolGap}.`
                    : 'Tool baseline has reached the current 28-tool target.'
                }
                ok={Boolean(summary?.toolsOk)}
              />
            </div>
          </section>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-2xl border border-border/70 bg-background/40 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Agent activity</h2>
                <p className="text-sm text-muted-foreground">What the runtime currently reports for registered agents.</p>
              </div>
              <Bot className="h-5 w-5 text-muted-foreground" />
            </div>

            <div className="overflow-hidden rounded-xl border border-border/70">
              <div className="grid grid-cols-[1.4fr_0.8fr_1fr] bg-muted/40 px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <span>Agent</span>
                <span>Status</span>
                <span>Last active</span>
              </div>
              <div className="divide-y divide-border/60">
                {data?.agents.agents.length ? (
                  data.agents.agents.map((agent) => (
                    <div key={agent.agentId} className="grid grid-cols-[1.4fr_0.8fr_1fr] px-4 py-3 text-sm">
                      <span className="truncate text-foreground">{agent.agentId}</span>
                      <span className="text-muted-foreground">{agent.status}</span>
                      <span className="text-muted-foreground">{formatDate(agent.lastActiveAt)}</span>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-6 text-sm text-muted-foreground">No agent records returned.</div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border/70 bg-background/40 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">Health components</h2>
                <p className="text-sm text-muted-foreground">Deep checks can expand this later; for now we show the current surface.</p>
              </div>
              <HeartPulse className="h-5 w-5 text-muted-foreground" />
            </div>

            <div className="space-y-2">
              {data?.health.components ? (
                Object.entries(data.health.components).map(([name, status]) => (
                  <div
                    key={name}
                    className="flex items-center justify-between rounded-xl border border-border/70 bg-card/50 px-4 py-3"
                  >
                    <span className="text-sm text-foreground">{name}</span>
                    <span
                      className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs ${
                        status === 'healthy'
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'bg-amber-500/10 text-amber-300'
                      }`}
                    >
                      {status === 'healthy' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                      {status}
                    </span>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-border/70 bg-card/50 px-4 py-6 text-sm text-muted-foreground">
                  The current `/health` endpoint only reports the top-level status.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  hint: string;
  icon: typeof Activity;
  tone: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
          <div className="mt-2 text-2xl font-semibold">{value}</div>
        </div>
        <div className="rounded-xl bg-background/40 p-2">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function KeyValueCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/50 p-4">
      <div className="mb-3 flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}

function CapabilityRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-card/50 px-4 py-3">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </div>
      <div className={`mt-0.5 inline-flex rounded-full px-2.5 py-1 text-xs ${ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
        {ok ? 'OK' : 'Gap'}
      </div>
    </div>
  );
}

function CapabilityPill({ title, description, ok }: { title: string; description: string; ok: boolean }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
          {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {ok ? 'Ready' : 'Needs work'}
        </div>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}
