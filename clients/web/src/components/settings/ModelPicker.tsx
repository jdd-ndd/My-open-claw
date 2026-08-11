import React from 'react';
import { Check, ChevronRight, Cpu, Flame, Rabbit, Sparkles, Zap } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useSettingsStore, type ModelSpeedMode, type ProviderOption } from '@/stores/useSettingsStore';

const PROVIDER_META: Record<ProviderOption, { label: string; caption: string; accent: string; icon: React.ReactNode }> = {
  deepseek: {
    label: 'DeepSeek',
    caption: 'DeepSeek official lineup',
    accent: 'from-sky-500/20 via-cyan-500/10 to-transparent',
    icon: <Sparkles className="h-4 w-4" />,
  },
  openclaw: {
    label: 'OpenClaw API',
    caption: 'Unified gateway routing',
    accent: 'from-rose-500/20 via-orange-500/10 to-transparent',
    icon: <Cpu className="h-4 w-4" />,
  },
  openai: {
    label: 'OpenAI',
    caption: 'General purpose reasoning',
    accent: 'from-emerald-500/20 via-teal-500/10 to-transparent',
    icon: <Flame className="h-4 w-4" />,
  },
};

const SPEED_OPTIONS: { value: ModelSpeedMode; label: string; description: string; icon: React.ReactNode }[] = [
  { value: 'default', label: 'Default', description: 'Balanced quality', icon: <Sparkles className="h-3.5 w-3.5" /> },
  { value: 'fast', label: 'Fast', description: 'Lower latency', icon: <Rabbit className="h-3.5 w-3.5" /> },
  { value: 'standard', label: 'Standard', description: 'Stable output', icon: <Zap className="h-3.5 w-3.5" /> },
  { value: 'auto', label: 'Auto', description: 'Route by task', icon: <Cpu className="h-3.5 w-3.5" /> },
];

interface ModelPickerProps {
  onClose?: () => void;
}

export const ModelPicker: React.FC<ModelPickerProps> = ({ onClose }) => {
  const provider = useSettingsStore((s) => s.defaultProvider);
  const model = useSettingsStore((s) => s.defaultModel);
  const speed = useSettingsStore((s) => s.modelSpeed);
  const providers = useSettingsStore((s) => s.modelCatalog.providers);
  const setProvider = useSettingsStore((s) => s.setDefaultProvider);
  const setModel = useSettingsStore((s) => s.setDefaultModel);
  const setSpeed = useSettingsStore((s) => s.setModelSpeed);
  const resetModelSelection = useSettingsStore((s) => s.resetModelSelection);

  const activeProvider = providers.find((item) => item.id === provider) ?? providers[0];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-border/60 bg-[linear-gradient(180deg,hsl(var(--card))_0%,hsl(var(--card)/0.96)_100%)] shadow-2xl shadow-black/20">
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] overflow-hidden">
        <aside className="border-r border-border/40 bg-black/10 px-4 py-5">
          <div className="mb-4 px-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground/80">Providers</p>
            <p className="mt-1 text-xs text-muted-foreground">Choose a vendor family first.</p>
          </div>

          <div className="space-y-2">
            {providers.map((item) => {
              const meta = PROVIDER_META[item.id] ?? PROVIDER_META.openclaw;
              const active = item.id === activeProvider.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setProvider(item.id)}
                  className={cn(
                    'group relative flex w-full items-start gap-3 overflow-hidden rounded-2xl border px-3 py-3 text-left transition-all duration-200',
                    active
                      ? 'border-primary/35 bg-white/6 text-foreground shadow-[0_12px_40px_-24px_hsl(var(--primary)/0.65)]'
                      : 'border-transparent text-muted-foreground hover:border-border/50 hover:bg-white/4 hover:text-foreground',
                  )}
                >
                  <div className={cn('absolute inset-0 bg-gradient-to-br opacity-70', meta.accent)} />
                  <div className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/6 text-foreground/90">
                    {meta.icon}
                  </div>
                  <div className="relative min-w-0 flex-1">
                    <div className="text-sm font-semibold">{meta.label}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{meta.caption}</div>
                  </div>
                  <ChevronRight className={cn('relative mt-1 h-4 w-4 flex-shrink-0 transition-transform', active ? 'text-primary' : 'opacity-40 group-hover:translate-x-0.5')} />
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col px-5 py-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-2xl font-semibold tracking-tight text-foreground">{PROVIDER_META[activeProvider.id]?.label ?? activeProvider.label}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{activeProvider.label} model lineup and routing preferences.</p>
            </div>
            <div className="rounded-full border border-border/50 bg-white/5 px-3 py-1 text-xs font-medium text-muted-foreground">
              {activeProvider.models.length} models
            </div>
          </div>

          <div className="scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {activeProvider.models.map((item) => {
              const active = item.id === model;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setProvider(activeProvider.id);
                    setModel(item.id);
                  }}
                  className={cn(
                    'group flex w-full items-start justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition-all duration-200',
                    active
                      ? 'border-primary/40 bg-primary/8 shadow-[0_10px_40px_-28px_hsl(var(--primary)/0.85)]'
                      : 'border-border/40 bg-white/[0.02] hover:border-border/70 hover:bg-white/[0.04]',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold text-foreground">{item.label}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{item.description}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      {item.tags.map((tag) => (
                        <span key={tag} className="rounded-full border border-border/40 bg-black/10 px-2 py-1">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center pt-1">
                    <span
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full border transition-all',
                        active ? 'border-primary/40 bg-primary text-primary-foreground' : 'border-border/50 text-transparent group-hover:text-muted-foreground',
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <div className="border-t border-border/50 bg-black/10 px-5 py-4">
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground/80">Speed</p>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {SPEED_OPTIONS.map((option) => {
              const active = option.value === speed;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSpeed(option.value)}
                  className={cn(
                    'rounded-2xl border px-3 py-3 text-left transition-all duration-200',
                    active
                      ? 'border-primary/40 bg-primary/10 text-foreground shadow-[0_10px_32px_-24px_hsl(var(--primary)/0.9)]'
                      : 'border-border/40 bg-white/[0.02] text-muted-foreground hover:border-border/70 hover:bg-white/[0.04] hover:text-foreground',
                  )}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {option.icon}
                    {option.label}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{option.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={resetModelSelection}
            className="inline-flex items-center justify-center rounded-2xl border border-border/50 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.06]"
          >
            Use default model
          </button>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-2xl border border-border/40 px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_-18px_rgba(244,63,94,0.85)] transition-transform hover:scale-[1.01]"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
