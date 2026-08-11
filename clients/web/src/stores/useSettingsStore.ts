import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';
export type FontSize = 'sm' | 'md' | 'lg';
export type ProviderOption = 'deepseek' | 'openclaw' | 'openai';
export type ModelSpeedMode = 'default' | 'fast' | 'standard' | 'auto';

export interface ModelCatalogEntry {
  id: string;
  label: string;
  description: string;
  tags: string[];
}

export interface ModelProviderGroup {
  id: ProviderOption;
  label: string;
  models: ModelCatalogEntry[];
}

interface SettingsState {
  defaultProvider: ProviderOption;
  defaultModel: string;
  modelSpeed: ModelSpeedMode;
  modelCatalog: {
    providers: ModelProviderGroup[];
  };
  temperature: number;
  maxTokens: number;
  defaultChannel: string;
  channelOverrides: Record<string, unknown>;
  themeMode: ThemeMode;
  messageFontSize: FontSize;
  codeTheme: string;
  showTokenUsage: boolean;
  autoReconnect: boolean;
  syncToServer: boolean;

  updateSetting: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  setDefaultProvider: (provider: ProviderOption) => void;
  setDefaultModel: (modelId: string) => void;
  setModelSpeed: (speed: ModelSpeedMode) => void;
  resetModelSelection: () => void;
  resetSettings: () => void;
}

const MODEL_CATALOG: SettingsState['modelCatalog'] = {
  providers: [
    {
      id: 'deepseek',
      label: 'DeepSeek',
      models: [
        {
          id: 'deepseek-chat',
          label: 'DeepSeek',
          description: 'General conversation and coding assistant with balanced speed and quality.',
          tags: ['chat', 'balanced', 'coding'],
        },
        {
          id: 'deepseek-v4-pro',
          label: 'V4 Pro',
          description: 'Higher quality reasoning path for harder analytical and generation tasks.',
          tags: ['reasoning', 'quality', 'pro'],
        },
      ],
    },
    {
      id: 'openclaw',
      label: 'OpenClaw API',
      models: [
        {
          id: 'openclaw-auto',
          label: 'OpenClaw Auto',
          description: 'Route tasks through the project gateway with unified tool and memory integration.',
          tags: ['gateway', 'auto-route', 'tools'],
        },
        {
          id: 'openclaw-reasoner',
          label: 'OpenClaw Reasoner',
          description: 'Preferred gateway profile for long-form planning, deep analysis, and chain-of-thought style output.',
          tags: ['planning', 'reasoning', 'memory'],
        },
      ],
    },
    {
      id: 'openai',
      label: 'OpenAI',
      models: [
        {
          id: 'gpt-4o',
          label: 'GPT-4o',
          description: 'Strong multimodal flagship for daily chat, coding, and instruction following.',
          tags: ['multimodal', 'flagship', 'general'],
        },
        {
          id: 'gpt-4o-mini',
          label: 'GPT-4o Mini',
          description: 'Faster and more cost-efficient option for lighter tasks and rapid interactions.',
          tags: ['fast', 'economical', 'lightweight'],
        },
      ],
    },
  ],
};

const DEFAULT_SETTINGS: Omit<SettingsState, 'updateSetting' | 'setDefaultProvider' | 'setDefaultModel' | 'setModelSpeed' | 'resetModelSelection' | 'resetSettings'> = {
  defaultProvider: 'deepseek',
  defaultModel: 'deepseek-chat',
  modelSpeed: 'default',
  modelCatalog: MODEL_CATALOG,
  temperature: 0.7,
  maxTokens: 4096,
  defaultChannel: 'default',
  channelOverrides: {},
  themeMode: 'system',
  messageFontSize: 'md',
  codeTheme: 'github-dark',
  showTokenUsage: false,
  autoReconnect: true,
  syncToServer: false,
};

function findProviderByModel(modelId: string): ProviderOption | null {
  for (const provider of MODEL_CATALOG.providers) {
    if (provider.models.some((model) => model.id === modelId)) {
      return provider.id;
    }
  }
  return null;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      updateSetting: (key, value) => set({ [key]: value }),

      setDefaultProvider: (provider) => {
        const providerGroup = MODEL_CATALOG.providers.find((item) => item.id === provider);
        set((state) => ({
          defaultProvider: provider,
          defaultModel:
            providerGroup?.models.some((model) => model.id === state.defaultModel)
              ? state.defaultModel
              : providerGroup?.models[0]?.id ?? state.defaultModel,
        }));
      },

      setDefaultModel: (modelId) => {
        const matchedProvider = findProviderByModel(modelId);
        set((state) => ({
          defaultModel: modelId,
          defaultProvider: matchedProvider ?? state.defaultProvider,
        }));
      },

      setModelSpeed: (speed) => set({ modelSpeed: speed }),

      resetModelSelection: () =>
        set({
          defaultProvider: DEFAULT_SETTINGS.defaultProvider,
          defaultModel: DEFAULT_SETTINGS.defaultModel,
          modelSpeed: DEFAULT_SETTINGS.modelSpeed,
        }),

      resetSettings: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: 'myopenclaw-settings-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        defaultProvider: state.defaultProvider,
        defaultModel: state.defaultModel,
        modelSpeed: state.modelSpeed,
        temperature: state.temperature,
        maxTokens: state.maxTokens,
        defaultChannel: state.defaultChannel,
        channelOverrides: state.channelOverrides,
        themeMode: state.themeMode,
        messageFontSize: state.messageFontSize,
        codeTheme: state.codeTheme,
        showTokenUsage: state.showTokenUsage,
        autoReconnect: state.autoReconnect,
        syncToServer: state.syncToServer,
      }),
      merge: (persistedState, currentState) => {
        const nextState = {
          ...currentState,
          ...(persistedState as Partial<SettingsState>),
          modelCatalog: MODEL_CATALOG,
        } as SettingsState;

        const inferredProvider = findProviderByModel(nextState.defaultModel);
        nextState.defaultProvider = inferredProvider ?? nextState.defaultProvider ?? DEFAULT_SETTINGS.defaultProvider;

        return nextState;
      },
    }
  )
);
