import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreferencesProvider } from "@/components/preferences-provider";
import { SettingsScreen } from "@/components/settings-screen";
import {
  LEGACY_PREFERENCES_STORAGE_KEYS,
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
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Changes are saved automatically|Değişiklikler otomatik kaydedilir/));
  return result;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
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
