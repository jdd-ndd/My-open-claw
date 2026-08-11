import { useEffect, useState } from 'react';
import { useSettingsStore, type ThemeMode } from '@/stores/useSettingsStore';

export function useTheme() {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  const setTheme = (mode: ThemeMode) => {
    updateSetting('themeMode', mode);
  };

  useEffect(() => {
    const root = window.document.documentElement;
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      root.classList.remove('light', 'dark');
      let resolved: 'light' | 'dark';
      if (themeMode === 'system') {
        resolved = systemPrefersDark.matches ? 'dark' : 'light';
      } else {
        resolved = themeMode;
      }
      root.classList.add(resolved);
      root.setAttribute('data-theme', resolved);
      setResolvedTheme(resolved);
    };

    applyTheme();

    const handleSystemChange = (_e: MediaQueryListEvent) => {
      if (themeMode === 'system') {
        applyTheme();
      }
    };

    systemPrefersDark.addEventListener('change', handleSystemChange);
    return () => {
      systemPrefersDark.removeEventListener('change', handleSystemChange);
    };
  }, [themeMode]);

  return { theme: themeMode, resolvedTheme, setTheme };
}
