import React from 'react';
import { X, Sun, Moon, Monitor, Sparkles } from 'lucide-react';
import { useSettingsStore, type ThemeMode } from '@/stores/useSettingsStore';
import { cn } from '@/utils/cn';
import { MemoryInspector } from './MemoryInspector';
import { ModelPicker } from './ModelPicker';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  currentSessionId?: string | null;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ open, onClose, currentSessionId }) => {
  const temperature = useSettingsStore((s) => s.temperature);
  const maxTokens = useSettingsStore((s) => s.maxTokens);
  const defaultChannel = useSettingsStore((s) => s.defaultChannel);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const messageFontSize = useSettingsStore((s) => s.messageFontSize);
  const showTokenUsage = useSettingsStore((s) => s.showTokenUsage);
  const autoReconnect = useSettingsStore((s) => s.autoReconnect);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const resetSettings = useSettingsStore((s) => s.resetSettings);

  const [activeTab, setActiveTab] = React.useState<'model' | 'channel' | 'interface' | 'memory'>('model');

  if (!open) return null;

  const themeModes: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: 'Light', icon: <Sun className="h-4 w-4" /> },
    { value: 'dark', label: 'Dark', icon: <Moon className="h-4 w-4" /> },
    { value: 'system', label: 'System', icon: <Monitor className="h-4 w-4" /> },
  ];

  return (
    <>
      <div className="fixed inset-0 z-40 animate-fade-in bg-black/30 backdrop-blur-sm" onClick={onClose} />

      <div className="fixed right-0 top-0 z-50 flex h-full w-[720px] max-w-[96vw] flex-col border-l border-border/50 bg-card/95 shadow-2xl backdrop-blur-xl">
        <div className="flex h-14 flex-shrink-0 items-center justify-between border-b border-border/50 px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-primary">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <h2 className="font-display text-base font-semibold tracking-tight">Settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-shrink-0 gap-1 border-b border-border/30 bg-muted/20 p-2">
          {[
            { key: 'model', label: 'Models' },
            { key: 'channel', label: 'Channel' },
            { key: 'interface', label: 'Interface' },
            { key: 'memory', label: 'Memory' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className={cn(
                'flex-1 rounded-lg py-2 text-sm font-medium transition-all',
                activeTab === tab.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
          {activeTab === 'model' && <ModelPicker onClose={onClose} />}

          {activeTab === 'channel' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Default channel</label>
                <select
                  value={defaultChannel}
                  onChange={(e) => updateSetting('defaultChannel', e.target.value)}
                  className="w-full rounded-xl border border-border/50 bg-background/80 px-3.5 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="default">Default</option>
                  <option value="webchat">Web Direct</option>
                </select>
              </div>
              <div className="rounded-xl border border-dashed border-border/50 bg-muted/40 p-4">
                <p className="text-xs leading-relaxed text-muted-foreground">Advanced channel routing will be expanded in a later pass.</p>
              </div>
            </div>
          )}

          {activeTab === 'interface' && (
            <div className="space-y-5">
              <div className="space-y-2.5">
                <label className="text-sm font-medium text-foreground">Theme mode</label>
                <div className="grid grid-cols-3 gap-2">
                  {themeModes.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => updateSetting('themeMode', mode.value)}
                      className={cn(
                        'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-sm transition-all',
                        themeMode === mode.value
                          ? 'border-primary/50 bg-primary/10 text-primary shadow-sm'
                          : 'border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      )}
                    >
                      {mode.icon}
                      <span className="text-xs font-medium">{mode.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Message font size</label>
                <select
                  value={messageFontSize}
                  onChange={(e) => updateSetting('messageFontSize', e.target.value as 'sm' | 'md' | 'lg')}
                  className="w-full rounded-xl border border-border/50 bg-background/80 px-3.5 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="sm">Small</option>
                  <option value="md">Medium</option>
                  <option value="lg">Large</option>
                </select>
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Temperature</label>
                  <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary">{temperature.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => updateSetting('temperature', parseFloat(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Max tokens</label>
                <input
                  type="number"
                  min={256}
                  max={8192}
                  step={256}
                  value={maxTokens}
                  onChange={(e) => updateSetting('maxTokens', Math.max(256, Math.min(8192, Number.parseInt(e.target.value || '0', 10) || 256)))}
                  className="w-full rounded-xl border border-border/50 bg-background/80 px-3.5 py-2.5 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between rounded-xl bg-muted/30 p-3">
                  <span className="text-sm text-foreground">Show token usage</span>
                  <button
                    type="button"
                    onClick={() => updateSetting('showTokenUsage', !showTokenUsage)}
                    className={cn('relative h-6 w-11 rounded-full transition-colors', showTokenUsage ? 'bg-gradient-primary' : 'bg-muted-foreground/30')}
                  >
                    <div className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform', showTokenUsage ? 'translate-x-[22px]' : 'translate-x-0.5')} />
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-xl bg-muted/30 p-3">
                  <span className="text-sm text-foreground">Auto reconnect</span>
                  <button
                    type="button"
                    onClick={() => updateSetting('autoReconnect', !autoReconnect)}
                    className={cn('relative h-6 w-11 rounded-full transition-colors', autoReconnect ? 'bg-gradient-primary' : 'bg-muted-foreground/30')}
                  >
                    <div className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform', autoReconnect ? 'translate-x-[22px]' : 'translate-x-0.5')} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'memory' && <MemoryInspector sessionId={currentSessionId} />}
        </div>

        <div className="flex-shrink-0 border-t border-border/50 p-4">
          <button
            type="button"
            onClick={resetSettings}
            className="w-full rounded-xl py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-red-500/5"
          >
            Reset all settings
          </button>
        </div>
      </div>
    </>
  );
};
