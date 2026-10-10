import type { AppLocale } from "@/lib/copy";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

export const PREFERENCES_STORAGE_KEY = "rag-steplab.preferences.v3";
export const LEGACY_PREFERENCES_STORAGE_KEYS = [
  "rag-steplab.preferences.v2",
  "rag-steplab.preferences.v1",
] as const;
export const THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";
export const DEFAULT_THEME: ThemePreference = "system";
/** PreferencesProvider's default; the server renders `<html lang>` with it. */
export const DEFAULT_LOCALE: AppLocale = "en";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "en" || value === "tr";
}

export function resolveTheme(theme: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

export function applyThemeToRoot(
  theme: ThemePreference,
  prefersDark: boolean,
  root: HTMLElement = document.documentElement,
): ResolvedTheme {
  const resolved = resolveTheme(theme, prefersDark);
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  return resolved;
}

const storageKeys = [PREFERENCES_STORAGE_KEY, ...LEGACY_PREFERENCES_STORAGE_KEYS];

// Bu script React bundle'ından önce çalışır. LocalStorage tabanlı tercih client-only
// olduğu için ilk paint'te doğru root class'ını uygulamanın en küçük güvenilir yolu budur.
export const THEME_BOOTSTRAP_SCRIPT = `(() => {
  const keys = ${JSON.stringify(storageKeys)};
  let theme = "system";
  try {
    for (const key of keys) {
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      try {
        const value = JSON.parse(raw);
        if (value && typeof value === "object") {
          theme = value.theme === "light" || value.theme === "dark" || value.theme === "system" ? value.theme : "system";
          break;
        }
      } catch {}
    }
  } catch {}
  let prefersDark = false;
  try { prefersDark = window.matchMedia(${JSON.stringify(THEME_MEDIA_QUERY)}).matches; } catch {}
  const resolved = theme === "dark" || (theme === "system" && prefersDark) ? "dark" : "light";
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
})();`;

// Same pattern and storage walk as THEME_BOOTSTRAP_SCRIPT and PreferencesProvider:
// the first stored object wins and an unknown locale falls back to the default.
// It only sets `<html lang>` before React; the provider owns it after hydration.
export const LOCALE_BOOTSTRAP_SCRIPT = `(() => {
  const keys = ${JSON.stringify(storageKeys)};
  let locale = ${JSON.stringify(DEFAULT_LOCALE)};
  try {
    for (const key of keys) {
      const raw = window.localStorage.getItem(key);
      if (raw === null) continue;
      try {
        const value = JSON.parse(raw);
        if (value && typeof value === "object") {
          locale = value.locale === "en" || value.locale === "tr" ? value.locale : ${JSON.stringify(DEFAULT_LOCALE)};
          break;
        }
      } catch {}
    }
  } catch {}
  document.documentElement.lang = locale;
})();`;
