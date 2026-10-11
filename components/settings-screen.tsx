"use client";

import { SlidingTabs, TransitionPanel } from "@/components/ui/transitions";

import { useState } from "react";

import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

// The selected pill gets its own edge so it reads against the track in both themes (E-8).
const segmentedClass = "flex h-10 w-full shrink-0 items-center justify-center gap-0 rounded-md border border-border bg-secondary p-1 sm:w-auto [&>.t-tabs-pill]:shadow-sm [&>.t-tabs-pill]:ring-1 [&>.t-tabs-pill]:ring-border";
// The radio itself is sr-only (its outline would be clipped), so the visible label carries focus (A3).
const segmentClass = "flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-sm px-2 text-sm text-muted-foreground transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring sm:flex-none sm:px-3";
const selectedSegmentClass = "bg-card font-medium text-foreground shadow-sm";
const rowClass = "flex min-h-16 flex-col items-stretch justify-center gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6";

export function SettingsScreen() {
  const {
    isHydrated,
    preferences,
    resetPreferences,
    setLocale,
    setShowLearningHints,
    setTheme,
  } = usePreferences();
  const copy = useCopy();
  // Announce only after a user change; hydrating stored preferences saves nothing (A10).
  const [savedNotice, setSavedNotice] = useState(false);
  const usesDefaults = preferences.locale === "en" && preferences.showLearningHints && preferences.theme === "system";
  const themeOptions = [
    { label: copy.settings.themeSystem, value: "system" },
    { label: copy.settings.themeLight, value: "light" },
    { label: copy.settings.themeDark, value: "dark" },
  ] as const;

  return (
    <div className="min-w-0 bg-background" data-testid="settings-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <PageHeader data-testid="settings-page-header" title={copy.settings.title} />
        <p aria-live="polite" className="sr-only" role="status">
          {savedNotice ? copy.settings.preferencesSaved : null}
        </p>

        <TransitionPanel as="section" className="mt-6 max-w-[720px] overflow-hidden rounded-lg border border-border bg-card"
          data-testid="settings-card"
        >
          <div className={rowClass} data-testid="settings-language-row">
            <h2 className="text-base font-medium text-foreground" id="settings-language-title">{copy.settings.languageTitle}</h2>
            <RadioGroup asChild aria-labelledby="settings-language-title" className={segmentedClass} onValueChange={(value) => { setLocale(value as "en" | "tr"); setSavedNotice(true); }} value={preferences.locale}>
              <SlidingTabs value={preferences.locale}>
              <label className={cn(segmentClass, preferences.locale === "en" && selectedSegmentClass)} htmlFor="locale-en">
                <RadioGroupItem aria-label={copy.settings.english} className="sr-only" id="locale-en" value="en" />
                <span>{copy.settings.english}</span>
              </label>
              <label className={cn(segmentClass, preferences.locale === "tr" && selectedSegmentClass)} htmlFor="locale-tr">
                <RadioGroupItem aria-label={copy.settings.turkish} className="sr-only" id="locale-tr" value="tr" />
                <span>{copy.settings.turkish}</span>
              </label>
            </SlidingTabs></RadioGroup>
          </div>

          <div className={rowClass} data-testid="settings-theme-row">
            <h2 className="text-base font-medium text-foreground" id="settings-theme-title">{copy.settings.themeTitle}</h2>
            <RadioGroup asChild aria-labelledby="settings-theme-title" className={segmentedClass} onValueChange={(value) => { setTheme(value as "system" | "light" | "dark"); setSavedNotice(true); }} value={preferences.theme}>
              <SlidingTabs value={preferences.theme}>
              {themeOptions.map((option) => (
                <label className={cn(segmentClass, preferences.theme === option.value && selectedSegmentClass, !isHydrated && "cursor-not-allowed opacity-60")} htmlFor={`theme-${option.value}`} key={option.value}>
                  <RadioGroupItem aria-label={option.label} className="sr-only" disabled={!isHydrated} id={`theme-${option.value}`} value={option.value} />
                  <span>{option.label}</span>
                </label>
              ))}
            </SlidingTabs></RadioGroup>
          </div>

          <div className="flex min-h-16 items-center justify-between gap-6 border-b border-border px-5 py-3">
            <div className="min-w-0">
              <h2 className="text-base font-medium text-foreground">{copy.settings.hintsTitle}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{copy.settings.hintsDescription}</p>
            </div>
            <Switch aria-label={copy.settings.hintsEnabled} checked={preferences.showLearningHints} id="show-learning-hints" onCheckedChange={(checked) => { setShowLearningHints(checked); setSavedNotice(true); }} />
          </div>

          <div className="flex min-h-16 items-center justify-between gap-6 px-5 py-3">
            <h2 className="text-base font-medium text-foreground">{copy.settings.resetTitle}</h2>
            <Button
              aria-describedby={!isHydrated || usesDefaults ? "reset-preferences-reason" : undefined}
              disabled={!isHydrated || usesDefaults}
              onClick={() => { resetPreferences(); setSavedNotice(true); }}
              size="sm"
              variant="outline"
            >
              {copy.settings.reset}
            </Button>
          </div>
            {(!isHydrated || usesDefaults) && (
              <p
                className="sr-only"
                id="reset-preferences-reason"
                key={isHydrated ? "default" : "pending"}
              >
                {isHydrated ? copy.settings.nothingToReset : copy.common.storagePending}
              </p>
            )}
        </TransitionPanel>
      </div>
    </div>
  );
}
