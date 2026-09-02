"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { AppLocale } from "@/lib/copy";
import {
  applyThemeToRoot,
  DEFAULT_THEME,
  isThemePreference,
  LEGACY_PREFERENCES_STORAGE_KEYS,
  PREFERENCES_STORAGE_KEY,
  THEME_MEDIA_QUERY,
  type ThemePreference,
} from "@/lib/theme";

export type AppPreferences = {
  locale: AppLocale;
  showLearningHints: boolean;
  theme: ThemePreference;
};

type PreferencesContextValue = {
  preferences: AppPreferences;
  isHydrated: boolean;
  setLocale: (locale: AppLocale) => void;
  setShowLearningHints: (showLearningHints: boolean) => void;
  setTheme: (theme: ThemePreference) => void;
  resetPreferences: () => void;
};

const DEFAULT_PREFERENCES: AppPreferences = {
  locale: "en",
  showLearningHints: true,
  theme: DEFAULT_THEME,
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

// Bazı bağımsız giriş noktaları (ör. auth callback testleri) provider olmadan
// render edilebilir. Uygulama shell'i gerçek provider'ı sağlar; bu fallback ise
// bu izole yüzeylerde dil tercihinin ve erişilebilir metinlerin deterministik
// kalmasını sağlar.
const FALLBACK_PREFERENCES: PreferencesContextValue = {
  preferences: { locale: "tr", showLearningHints: true, theme: DEFAULT_THEME },
  isHydrated: true,
  setLocale: () => undefined,
  setShowLearningHints: () => undefined,
  setTheme: () => undefined,
  resetPreferences: () => undefined,
};

function isLocale(value: unknown): value is AppLocale {
  return value === "en" || value === "tr";
}

function readStoredPreferences(): AppPreferences {
  try {
    for (const key of [PREFERENCES_STORAGE_KEY, ...LEGACY_PREFERENCES_STORAGE_KEYS]) {
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;

      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") continue;

        const stored = parsed as Partial<AppPreferences>;
        return {
          locale: isLocale(stored.locale) ? stored.locale : DEFAULT_PREFERENCES.locale,
          showLearningHints: typeof stored.showLearningHints === "boolean" ? stored.showLearningHints : DEFAULT_PREFERENCES.showLearningHints,
          theme: isThemePreference(stored.theme) ? stored.theme : DEFAULT_PREFERENCES.theme,
        };
      } catch {
        // Bozuk yeni kayıt varsa parse edilebilir eski preference kaydını dene.
      }
    }

    return DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setPreferences(readStoredPreferences());
      setIsHydrated(true);
    });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = preferences.locale;
  }, [preferences.locale]);

  useEffect(() => {
    if (!isHydrated) return;

    let mediaQuery: MediaQueryList | null = null;
    try {
      mediaQuery = window.matchMedia(THEME_MEDIA_QUERY);
    } catch {
      // matchMedia olmayan ortamlarda System güvenli biçimde Light'a çözülür.
    }

    const applyTheme = () => applyThemeToRoot(preferences.theme, mediaQuery?.matches ?? false);
    applyTheme();

    if (preferences.theme !== "system" || !mediaQuery) return;
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery?.removeEventListener("change", applyTheme);
  }, [isHydrated, preferences.theme]);

  useEffect(() => {
    if (!isHydrated) return;

    try {
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
      for (const key of LEGACY_PREFERENCES_STORAGE_KEYS) window.localStorage.removeItem(key);
    } catch {
      // localStorage erişimi olmayan ortamlarda arayüz tercihleri yine oturum boyunca çalışır.
    }
  }, [isHydrated, preferences]);

  const updatePreferences = useCallback((update: (current: AppPreferences) => AppPreferences) => {
    setPreferences(update);
  }, []);

  const setLocale = useCallback((locale: AppLocale) => {
    updatePreferences((current) => ({ ...current, locale }));
  }, [updatePreferences]);

  const setShowLearningHints = useCallback((showLearningHints: boolean) => {
    updatePreferences((current) => ({ ...current, showLearningHints }));
  }, [updatePreferences]);

  const setTheme = useCallback((theme: ThemePreference) => {
    updatePreferences((current) => ({ ...current, theme }));
  }, [updatePreferences]);

  const resetPreferences = useCallback(() => {
    updatePreferences(() => DEFAULT_PREFERENCES);
  }, [updatePreferences]);

  const value = useMemo<PreferencesContextValue>(() => ({
    preferences,
    isHydrated,
    setLocale,
    setShowLearningHints,
    setTheme,
    resetPreferences,
  }), [isHydrated, preferences, resetPreferences, setLocale, setShowLearningHints, setTheme]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  return context ?? FALLBACK_PREFERENCES;
}
