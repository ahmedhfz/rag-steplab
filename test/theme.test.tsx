import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreferencesProvider } from "@/components/preferences-provider";
import { SettingsScreen } from "@/components/settings-screen";
import {
  LEGACY_PREFERENCES_STORAGE_KEYS,
  LOCALE_BOOTSTRAP_SCRIPT,
  PREFERENCES_STORAGE_KEY,
  THEME_BOOTSTRAP_SCRIPT,
} from "@/lib/theme";

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    get matches() { return matches; },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList;

  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
  return {
    mediaQuery,
    setMatches(next: boolean) {
      matches = next;
      const event = { matches: next, media: mediaQuery.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

async function renderSettings() {
  const result = render(<PreferencesProvider><SettingsScreen /></PreferencesProvider>);
  // Theme radios stay disabled until stored preferences are read.
  await waitFor(() => expect(screen.getByRole("radio", { name: /^(System|Sistem)$/ })).toBeEnabled());
  return result;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
  document.documentElement.lang = "en";
  vi.unstubAllGlobals();
});

describe("theme preferences", () => {
  it.each(LEGACY_PREFERENCES_STORAGE_KEYS)("migrates %s without losing fields and defaults theme to System", async (legacyKey) => {
    installMatchMedia(true);
    localStorage.setItem(legacyKey, JSON.stringify({ locale: "tr", showLearningHints: false }));

    await renderSettings();

    expect(screen.getByLabelText("Sistem")).toBeChecked();
    expect(document.documentElement).toHaveClass("dark");
    await waitFor(() => expect(localStorage.getItem(legacyKey)).toBeNull());
    expect(JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "{}")).toEqual({
      locale: "tr",
      showLearningHints: false,
      theme: "system",
    });
  });

  it("applies Light and Dark explicitly and follows live OS changes only in System mode", async () => {
    const user = userEvent.setup();
    const matchMedia = installMatchMedia(false);
    await renderSettings();

    expect(document.documentElement).not.toHaveClass("dark");
    act(() => matchMedia.setMatches(true));
    expect(document.documentElement).toHaveClass("dark");

    await user.click(screen.getByLabelText("Light"));
    expect(document.documentElement).not.toHaveClass("dark");
    act(() => matchMedia.setMatches(true));
    expect(document.documentElement).not.toHaveClass("dark");

    await user.click(screen.getByLabelText("Dark"));
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "{}")).toMatchObject({ theme: "dark" });
  });

  it("removes the System media listener when the preference changes and on unmount", async () => {
    const user = userEvent.setup();
    const { mediaQuery } = installMatchMedia(false);
    const view = await renderSettings();

    expect(mediaQuery.addEventListener).toHaveBeenCalledTimes(1);
    await user.click(screen.getByLabelText("Dark"));
    expect(mediaQuery.removeEventListener).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText("System"));
    expect(mediaQuery.addEventListener).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledTimes(2);
  });

  it("bootstraps Dark before hydration for explicit Dark and System-dark preferences", () => {
    const matchMedia = installMatchMedia(true);
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ theme: "system" }));
    new Function(THEME_BOOTSTRAP_SCRIPT)();
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    document.documentElement.classList.remove("dark");
    matchMedia.setMatches(false);
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ theme: "dark" }));
    new Function(THEME_BOOTSTRAP_SCRIPT)();
    expect(document.documentElement).toHaveClass("dark");
  });
});

describe("locale bootstrap", () => {
  function bootstrapLocale() {
    document.documentElement.lang = "en";
    new Function(LOCALE_BOOTSTRAP_SCRIPT)();
    return document.documentElement.lang;
  }

  it("sets <html lang> from the stored locale before hydration", () => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ locale: "tr", theme: "system" }));
    expect(bootstrapLocale()).toBe("tr");
  });

  it("walks the storage keys in the provider's order and falls back to the default locale", () => {
    expect(bootstrapLocale()).toBe("en");

    // A corrupt current record defers to the first parseable legacy record, like the provider.
    localStorage.setItem(PREFERENCES_STORAGE_KEY, "{not json");
    localStorage.setItem(LEGACY_PREFERENCES_STORAGE_KEYS[0], JSON.stringify({ locale: "tr" }));
    expect(bootstrapLocale()).toBe("tr");

    // The first stored object wins even when its locale is unknown.
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ locale: "de" }));
    expect(bootstrapLocale()).toBe("en");
  });

  it("agrees with the provider's hydrated locale", async () => {
    localStorage.setItem(LEGACY_PREFERENCES_STORAGE_KEYS[1], JSON.stringify({ locale: "tr", showLearningHints: true }));
    expect(bootstrapLocale()).toBe("tr");
    await renderSettings();
    expect(screen.getByRole("heading", { name: "Ayarlar" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("tr");
  });
});
