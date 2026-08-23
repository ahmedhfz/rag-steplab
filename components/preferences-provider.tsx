"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { AppLocale, DetailLevel } from "@/lib/copy";

export type AppPreferences = {
  locale: AppLocale;
  detailLevel: DetailLevel;
  showLearningHints: boolean;
};

type PreferencesContextValue = {
  preferences: AppPreferences;
  isHydrated: boolean;
  setLocale: (locale: AppLocale) => void;
  setDetailLevel: (detailLevel: DetailLevel) => void;
  setShowLearningHints: (showLearningHints: boolean) => void;
  resetPreferences: () => void;
};

const STORAGE_KEY = "rag-steplab.preferences.v1";
const DEFAULT_PREFERENCES: AppPreferences = {
  locale: "en",
  detailLevel: "guided",
  showLearningHints: true,
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

// Bazı bağımsız giriş noktaları (ör. auth callback testleri) provider olmadan
// render edilebilir. Uygulama shell'i gerçek provider'ı sağlar; bu fallback ise
// bu izole yüzeylerde dil tercihinin ve erişilebilir metinlerin deterministik
// kalmasını sağlar.
const FALLBACK_PREFERENCES: PreferencesContextValue = {
  preferences: { locale: "tr", detailLevel: "guided", showLearningHints: true },
  isHydrated: true,
  setLocale: () => undefined,
  setDetailLevel: () => undefined,
  setShowLearningHints: () => undefined,
  resetPreferences: () => undefined,
};

function isLocale(value: unknown): value is AppLocale {
  return value === "en" || value === "tr";
}

function isDetailLevel(value: unknown): value is DetailLevel {
  return value === "guided" || value === "technical";
}

function readStoredPreferences(): AppPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_PREFERENCES;

    const stored = parsed as Partial<AppPreferences>;
    return {
      locale: isLocale(stored.locale) ? stored.locale : DEFAULT_PREFERENCES.locale,
      detailLevel: isDetailLevel(stored.detailLevel) ? stored.detailLevel : DEFAULT_PREFERENCES.detailLevel,
      showLearningHints: typeof stored.showLearningHints === "boolean" ? stored.showLearningHints : DEFAULT_PREFERENCES.showLearningHints,
    };
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

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
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

  const setDetailLevel = useCallback((detailLevel: DetailLevel) => {
    updatePreferences((current) => ({ ...current, detailLevel }));
  }, [updatePreferences]);

  const setShowLearningHints = useCallback((showLearningHints: boolean) => {
    updatePreferences((current) => ({ ...current, showLearningHints }));
  }, [updatePreferences]);

  const resetPreferences = useCallback(() => {
    updatePreferences(() => DEFAULT_PREFERENCES);
  }, [updatePreferences]);

  const value = useMemo<PreferencesContextValue>(() => ({
    preferences,
    isHydrated,
    setLocale,
    setDetailLevel,
    setShowLearningHints,
    resetPreferences,
  }), [isHydrated, preferences, resetPreferences, setDetailLevel, setLocale, setShowLearningHints]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  return context ?? FALLBACK_PREFERENCES;
}
