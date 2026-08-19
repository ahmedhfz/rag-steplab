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
    setDetailLevel,
    setLocale,
    setShowLearningHints,
  } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const usesDefaults = preferences.locale === "en" && preferences.detailLevel === "guided" && preferences.showLearningHints;

  return (
    <div>
      <section className="border-b px-4 py-7 sm:px-8 sm:py-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.025em]">{copy.settings.title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{copy.settings.description}</p>
          </div>
          <AnimatePresence initial={false} mode="wait">
            <motion.p
              animate={{ opacity: 1, y: 0 }}
              aria-live="polite"
              className="text-xs text-slate-500"
              exit={{ opacity: 0, y: -3 }}
              initial={{ opacity: 1, y: 3 }}
              key={isHydrated ? "saved" : "pending"}
              role="status"
              transition={{ duration: 0.14, ease: "easeOut" }}
            >
              {isHydrated ? copy.settings.preferencesSaved : copy.common.storagePending}
            </motion.p>
          </AnimatePresence>
        </div>
      </section>

      <div className="divide-y">
        <motion.section animate={{ opacity: 1, y: 0 }} className="grid gap-5 px-4 py-6 sm:px-8 md:grid-cols-[minmax(180px,0.35fr)_minmax(0,1fr)]" initial={{ opacity: 0, y: 5 }} transition={{ duration: 0.16, ease: "easeOut" }}>
          <div>
            <h2 className="text-sm font-semibold">{copy.settings.languageTitle}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{copy.settings.languageDescription}</p>
          </div>
          <RadioGroup aria-label={copy.settings.languageTitle} className="sm:grid-cols-2" onValueChange={(value) => setLocale(value as "en" | "tr")} value={preferences.locale}>
            <label className={cn("flex cursor-pointer items-center gap-3 border px-4 py-3 text-sm transition-colors hover:bg-slate-50", preferences.locale === "en" && "border-slate-950 bg-slate-50")} htmlFor="locale-en">
              <RadioGroupItem aria-label={copy.settings.english} id="locale-en" value="en" />
              <span>{copy.settings.english}</span>
            </label>
            <label className={cn("flex cursor-pointer items-center gap-3 border px-4 py-3 text-sm transition-colors hover:bg-slate-50", preferences.locale === "tr" && "border-slate-950 bg-slate-50")} htmlFor="locale-tr">
              <RadioGroupItem aria-label={copy.settings.turkish} id="locale-tr" value="tr" />
              <span>{copy.settings.turkish}</span>
            </label>
          </RadioGroup>
        </motion.section>

        <motion.section animate={{ opacity: 1, y: 0 }} className="grid gap-5 px-4 py-6 sm:px-8 md:grid-cols-[minmax(180px,0.35fr)_minmax(0,1fr)]" initial={{ opacity: 0, y: 5 }} transition={{ duration: 0.16, delay: 0.035, ease: "easeOut" }}>
          <div>
            <h2 className="text-sm font-semibold">{copy.settings.detailTitle}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{copy.settings.detailDescription}</p>
          </div>
          <RadioGroup aria-label={copy.settings.detailTitle} className="sm:grid-cols-2" onValueChange={(value) => setDetailLevel(value as "guided" | "technical")} value={preferences.detailLevel}>
            <label className={cn("flex cursor-pointer gap-3 border px-4 py-3 transition-colors hover:bg-slate-50", preferences.detailLevel === "guided" && "border-slate-950 bg-slate-50")} htmlFor="detail-guided">
              <RadioGroupItem aria-describedby="detail-guided-description" aria-label={copy.settings.guided} className="mt-0.5" id="detail-guided" value="guided" />
              <span>
                <span className="block text-sm font-medium">{copy.settings.guided}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500" id="detail-guided-description">{copy.settings.guidedDescription}</span>
              </span>
            </label>
            <label className={cn("flex cursor-pointer gap-3 border px-4 py-3 transition-colors hover:bg-slate-50", preferences.detailLevel === "technical" && "border-slate-950 bg-slate-50")} htmlFor="detail-technical">
              <RadioGroupItem aria-describedby="detail-technical-description" aria-label={copy.settings.technical} className="mt-0.5" id="detail-technical" value="technical" />
              <span>
                <span className="block text-sm font-medium">{copy.settings.technical}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500" id="detail-technical-description">{copy.settings.technicalDescription}</span>
              </span>
            </label>
          </RadioGroup>
        </motion.section>

        <motion.section animate={{ opacity: 1, y: 0 }} className="grid gap-5 px-4 py-6 sm:px-8 md:grid-cols-[minmax(180px,0.35fr)_minmax(0,1fr)]" initial={{ opacity: 0, y: 5 }} transition={{ duration: 0.16, delay: 0.07, ease: "easeOut" }}>
          <div>
            <h2 className="text-sm font-semibold">{copy.settings.hintsTitle}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{copy.settings.hintsDescription}</p>
          </div>
          <label className={cn("flex max-w-xl cursor-pointer items-center justify-between gap-4 border px-4 py-3 text-sm transition-colors hover:bg-slate-50", preferences.showLearningHints && "border-slate-950 bg-slate-50")} htmlFor="show-learning-hints">
            <span>{copy.settings.hintsEnabled}</span>
            <Switch aria-label={copy.settings.hintsEnabled} checked={preferences.showLearningHints} id="show-learning-hints" onCheckedChange={setShowLearningHints} />
          </label>
        </motion.section>

        <motion.section animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-8" initial={{ opacity: 0, y: 5 }} transition={{ duration: 0.16, delay: 0.105, ease: "easeOut" }}>
          <div>
            <h2 className="text-sm font-semibold">{copy.settings.resetTitle}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">{copy.settings.resetDescription}</p>
          </div>
          <Button
            aria-describedby={!isHydrated || usesDefaults ? "reset-preferences-reason" : undefined}
            disabled={!isHydrated || usesDefaults}
            onClick={resetPreferences}
            variant="outline"
          >
            {copy.settings.reset}
          </Button>
        </motion.section>
        <AnimatePresence initial={false} mode="wait">
          {(!isHydrated || usesDefaults) && (
            <motion.p
              animate={{ opacity: 1, y: 0 }}
              className="px-4 pb-6 text-xs text-slate-500 sm:px-8"
              exit={{ opacity: 0, y: -3 }}
              id="reset-preferences-reason"
              initial={{ opacity: 1, y: 3 }}
              key={isHydrated ? "default" : "pending"}
              transition={{ duration: 0.14, ease: "easeOut" }}
            >
              {isHydrated ? copy.settings.nothingToReset : copy.common.storagePending}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
