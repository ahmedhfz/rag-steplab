"use client";

import type { ReactNode } from "react";
import { I18nProvider } from "react-aria-components";

import { usePreferences } from "@/components/preferences-provider";
import { Toaster } from "@/components/ui/toast";

/**
 * Design-system runtime, mounted once in app/layout.tsx inside PreferencesProvider:
 *  - React Aria formats numbers/dates and reads direction in the app's locale, not the browser's.
 *  - The single Sonner <Toaster/>.
 */
export function UiProvider({ children }: { children: ReactNode }) {
  const { preferences } = usePreferences();
  return (
    <I18nProvider locale={preferences.locale === "tr" ? "tr-TR" : "en-US"}>
      {children}
      <Toaster />
    </I18nProvider>
  );
}
