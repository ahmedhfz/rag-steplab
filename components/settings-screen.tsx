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
  } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const usesDefaults = preferences.locale === "en" && preferences.showLearningHints;

  return (
    <div className="min-w-0 overflow-x-clip bg-[#f8f7f7]" data-testid="settings-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <header data-testid="settings-page-header">
          <h1 className="mt-0 text-[30px] font-semibold leading-9 tracking-[-0.6px] text-[#171416]">{copy.settings.title}</h1>
          <p className="mt-2 text-sm leading-[21px] text-[#6e676a]">{copy.settings.description}</p>
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
          className="mt-8 max-w-[720px] overflow-hidden rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white"
          data-testid="settings-card"
          initial={{ opacity: 0, y: 5 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
        >
          <div className="flex h-[84px] items-center justify-between gap-6 border-b-[1.712px] border-[#e7e2e4] px-6">
            <div className="min-w-0">
              <h2 className="text-sm font-medium leading-[21px] text-[#171416]">{copy.settings.languageTitle}</h2>
              <p className="mt-0.5 text-[13px] leading-5 text-[#6e676a]">{copy.settings.languageDescription}</p>
            </div>
            <RadioGroup aria-label={copy.settings.languageTitle} className="flex h-[42px] shrink-0 items-center gap-0 rounded-[10px] border border-[#e7e2e4] bg-[#f2eff0] p-1" onValueChange={(value) => setLocale(value as "en" | "tr")} value={preferences.locale}>
              <label className={cn("flex min-h-10 cursor-pointer items-center rounded-[8px] px-3 text-[13px] text-[#6e676a] transition-colors", preferences.locale === "en" && "bg-white font-medium text-[#171416] shadow-sm")} htmlFor="locale-en">
                <RadioGroupItem aria-label={copy.settings.english} className="sr-only" id="locale-en" value="en" />
                <span>{copy.settings.english}</span>
              </label>
              <label className={cn("flex min-h-10 cursor-pointer items-center rounded-[8px] px-3 text-[13px] text-[#6e676a] transition-colors", preferences.locale === "tr" && "bg-white font-medium text-[#171416] shadow-sm")} htmlFor="locale-tr">
                <RadioGroupItem aria-label={copy.settings.turkish} className="sr-only" id="locale-tr" value="tr" />
                <span>{copy.settings.turkish}</span>
              </label>
            </RadioGroup>
          </div>

          <div className="flex h-[84px] items-center justify-between gap-6 border-b-[1.712px] border-[#e7e2e4] px-6">
            <div className="min-w-0">
              <h2 className="text-sm font-medium leading-[21px] text-[#171416]">{copy.settings.hintsTitle}</h2>
              <p className="mt-0.5 text-[13px] leading-5 text-[#6e676a]">{copy.settings.hintsDescription}</p>
            </div>
            <Switch aria-label={copy.settings.hintsEnabled} checked={preferences.showLearningHints} id="show-learning-hints" onCheckedChange={setShowLearningHints} />
          </div>

          <div className="flex h-[84px] items-center justify-between gap-6 px-6">
            <div className="min-w-0">
              <h2 className="text-sm font-medium leading-[21px] text-[#171416]">{copy.settings.resetTitle}</h2>
              <p className="mt-0.5 text-[13px] leading-5 text-[#6e676a]">{copy.settings.resetDescription}</p>
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
