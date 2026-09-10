"use client";

import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { UI_COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";

export function SettingsScreen() {
  const {
    isHydrated,
    preferences,
    resetPreferences,
    setLocale,
    setShowLearningHints,
    setTheme,
  } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const usesDefaults = preferences.locale === "en" && preferences.showLearningHints && preferences.theme === "system";
  const themeOptions = [
    { label: copy.settings.themeSystem, value: "system" },
    { label: copy.settings.themeLight, value: "light" },
    { label: copy.settings.themeDark, value: "dark" },
  ] as const;

  return (
    <div className="min-w-0 overflow-x-clip bg-background" data-testid="settings-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <header data-testid="settings-page-header">
          <h1 className="mt-0 text-[30px] font-semibold leading-9 tracking-[-0.6px] text-foreground">{copy.settings.title}</h1>
          <p className="mt-2 text-sm leading-[21px] text-muted-foreground">{copy.settings.description}</p>
          <AnimatePresence initial={false} mode="wait">
            <motion.p
              animate={{ opacity: 1 }}
              aria-live="polite"
              className="sr-only"
              exit={{ opacity: 0 }}
              initial={{ opacity: 1 }}
              key={isHydrated ? "saved" : "pending"}
              role="status"
            >
              {isHydrated ? copy.settings.preferencesSaved : copy.common.storagePending}
            </motion.p>
          </AnimatePresence>
        </header>

        <motion.section
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 max-w-[720px] overflow-hidden rounded-[16px] border-[1.712px] border-border bg-card"
          data-testid="settings-card"
          initial={{ opacity: 0, y: 5 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <div className="flex min-h-[72px] flex-col items-stretch justify-center gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <h2 className="text-sm font-medium leading-[21px] text-foreground">{copy.settings.languageTitle}</h2>
              <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{copy.settings.languageDescription}</p>
            </div>
            <RadioGroup aria-label={copy.settings.languageTitle} className="flex h-[42px] w-full shrink-0 items-center justify-center gap-0 rounded-[10px] border border-border bg-secondary p-1 sm:w-auto" onValueChange={(value) => setLocale(value as "en" | "tr")} value={preferences.locale}>
              <label className={cn("flex min-h-10 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-[8px] px-2 text-[13px] text-muted-foreground transition-colors sm:flex-none sm:px-3", preferences.locale === "en" && "bg-card font-medium text-foreground shadow-sm")} htmlFor="locale-en">
                <RadioGroupItem aria-label={copy.settings.english} className="sr-only" id="locale-en" value="en" />
                <span>{copy.settings.english}</span>
              </label>
              <label className={cn("flex min-h-10 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-[8px] px-2 text-[13px] text-muted-foreground transition-colors sm:flex-none sm:px-3", preferences.locale === "tr" && "bg-card font-medium text-foreground shadow-sm")} htmlFor="locale-tr">
                <RadioGroupItem aria-label={copy.settings.turkish} className="sr-only" id="locale-tr" value="tr" />
                <span>{copy.settings.turkish}</span>
              </label>
            </RadioGroup>
          </div>

          <div className="flex min-h-[72px] flex-col items-stretch justify-center gap-3 border-b border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <h2 className="text-sm font-medium leading-[21px] text-foreground">{copy.settings.themeTitle}</h2>
              <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{copy.settings.themeDescription}</p>
            </div>
            <RadioGroup aria-label={copy.settings.themeTitle} className="flex h-[42px] w-full shrink-0 items-center justify-center gap-0 rounded-[10px] border border-border bg-secondary p-1 sm:w-auto" onValueChange={(value) => setTheme(value as "system" | "light" | "dark")} value={preferences.theme}>
              {themeOptions.map((option) => (
                <label className={cn("flex min-h-10 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-[8px] px-2 text-[13px] text-muted-foreground transition-colors sm:flex-none sm:px-3", preferences.theme === option.value && "bg-card font-medium text-foreground shadow-sm", !isHydrated && "cursor-not-allowed opacity-60")} htmlFor={`theme-${option.value}`} key={option.value}>
                  <RadioGroupItem aria-label={option.label} className="sr-only" disabled={!isHydrated} id={`theme-${option.value}`} value={option.value} />
                  <span>{option.label}</span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div className="flex min-h-[72px] items-center justify-between gap-6 border-b border-border px-5 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-medium leading-[21px] text-foreground">{copy.settings.hintsTitle}</h2>
              <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{copy.settings.hintsDescription}</p>
            </div>
            <Switch aria-label={copy.settings.hintsEnabled} checked={preferences.showLearningHints} id="show-learning-hints" onCheckedChange={setShowLearningHints} />
          </div>

          <div className="flex min-h-[72px] items-center justify-between gap-6 px-5 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-medium leading-[21px] text-foreground">{copy.settings.resetTitle}</h2>
              <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{copy.settings.resetDescription}</p>
            </div>
            <Button
              aria-describedby={!isHydrated || usesDefaults ? "reset-preferences-reason" : undefined}
              className="h-8 rounded-[9px] px-3 text-[13px]"
              disabled={!isHydrated || usesDefaults}
              onClick={resetPreferences}
              variant="outline"
            >
              {copy.settings.reset}
            </Button>
          </div>
          <AnimatePresence initial={false} mode="wait">
            {(!isHydrated || usesDefaults) && (
              <motion.p
                animate={{ opacity: 1 }}
                className="sr-only"
                exit={{ opacity: 0 }}
                id="reset-preferences-reason"
                initial={{ opacity: 1 }}
                key={isHydrated ? "default" : "pending"}
              >
                {isHydrated ? copy.settings.nothingToReset : copy.common.storagePending}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.section>
      </div>
    </div>
  );
}
