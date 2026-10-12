"use client";

import { SlidingTabs, TransitionPanel } from "@/components/ui/transitions";

import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { useState, type ReactNode } from "react";

import { usePreferences } from "@/components/preferences-provider";
import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

type ThemeValue = "system" | "light" | "dark";
type LocaleValue = "en" | "tr";
type PreferenceOption<T extends string> = { value: T; label: string; icon?: SemanticIconName };

/**
 * Settings' segmented choice: a radio group whose visible segments are <label for> elements and
 * whose radios are sr-only, so focus shows on the segment (A3); the transitions.dev pill slides
 * to the checked label. Full width on phones so the segments share the row instead of spilling.
 */
function PreferenceSegments<T extends string>({ disabled = false, idPrefix, labelledBy, onChange, options, value }: { disabled?: boolean; idPrefix: string; labelledBy: string; onChange: (value: T) => void; options: ReadonlyArray<PreferenceOption<T>>; value: T }) {
  return (
    <RadioGroupPrimitive.Root asChild aria-labelledby={labelledBy} disabled={disabled} onValueChange={(next) => onChange(next as T)} value={value}>
      <SlidingTabs
        className="flex w-full rounded-lg bg-tertiary p-0.5 ring-1 ring-secondary ring-inset sm:inline-flex sm:w-auto dark:bg-secondary_alt [&>.t-tabs-pill]:bg-primary [&>.t-tabs-pill]:shadow-sm [&>.t-tabs-pill]:ring-1 [&>.t-tabs-pill]:ring-secondary_alt dark:[&>.t-tabs-pill]:bg-quaternary"
        value={value}
      >
        {options.map((option) => (
          <label
            className={cn(
              "flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold whitespace-nowrap text-tertiary transition-colors hover:text-secondary sm:flex-none",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-0 has-[:focus-visible]:outline-focus-ring",
              value === option.value && "text-primary hover:text-primary",
              disabled && "cursor-not-allowed opacity-60",
            )}
            htmlFor={`${idPrefix}-${option.value}`}
            key={option.value}
          >
            <RadioGroupPrimitive.Item aria-label={option.label} className="sr-only" id={`${idPrefix}-${option.value}`} value={option.value} />
            {option.icon ? <AppIcon className="size-4 shrink-0 max-sm:hidden" name={option.icon} /> : null}
            <span>{option.label}</span>
          </label>
        ))}
      </SlidingTabs>
    </RadioGroupPrimitive.Root>
  );
}

/**
 * One preference: title on the left, its control on the right; stacked on small screens.
 * `description` is for assistive technology only (e.g. why a control is disabled).
 */
function SettingRow({ title, titleId, description, descriptionId, control, testId, stackOnMobile = true }: { title: string; titleId?: string; description?: ReactNode; descriptionId?: string; control: ReactNode; testId?: string; stackOnMobile?: boolean }) {
  return (
    <div
      className={cn(
        "flex gap-x-8 gap-y-3 px-5 py-4 sm:min-h-18 sm:flex-row sm:items-center sm:justify-between",
        stackOnMobile ? "flex-col items-stretch" : "items-center justify-between",
      )}
      data-testid={testId}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-primary" id={titleId}>{title}</h2>
        {description ? <p className="sr-only" id={descriptionId}>{description}</p> : null}
      </div>
      <div className="min-w-0 sm:shrink-0">{control}</div>
    </div>
  );
}

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
  const resetUnavailable = !isHydrated || usesDefaults;

  return (
    <div className="min-w-0" data-testid="settings-screen">
      <div className="mx-auto w-full max-w-container p-10 max-md:p-4">
        <PageHeader data-testid="settings-page-header" title={copy.settings.title} />
        <p aria-live="polite" className="sr-only" role="status">
          {savedNotice ? copy.settings.preferencesSaved : null}
        </p>

        <TransitionPanel
          as="section"
          className="mt-8 max-w-180 divide-y divide-secondary rounded-xl bg-primary shadow-xs ring-1 ring-secondary"
          data-testid="settings-card"
        >
          <SettingRow
            control={(
              <PreferenceSegments<LocaleValue>
                idPrefix="locale"
                labelledBy="settings-language-title"
                onChange={(value) => { setLocale(value); setSavedNotice(true); }}
                options={[
                  { value: "en", label: copy.settings.english },
                  { value: "tr", label: copy.settings.turkish },
                ]}
                value={preferences.locale}
              />
            )}
            testId="settings-language-row"
            title={copy.settings.languageTitle}
            titleId="settings-language-title"
          />

          <SettingRow
            control={(
              <PreferenceSegments<ThemeValue>
                disabled={!isHydrated}
                idPrefix="theme"
                labelledBy="settings-theme-title"
                onChange={(value) => { setTheme(value); setSavedNotice(true); }}
                options={[
                  { value: "system", label: copy.settings.themeSystem, icon: "monitor" },
                  { value: "light", label: copy.settings.themeLight, icon: "sun" },
                  { value: "dark", label: copy.settings.themeDark, icon: "moon" },
                ]}
                value={preferences.theme}
              />
            )}
            testId="settings-theme-row"
            title={copy.settings.themeTitle}
            titleId="settings-theme-title"
          />

          <SettingRow
            control={<Switch aria-label={copy.settings.hintsEnabled} checked={preferences.showLearningHints} id="show-learning-hints" onCheckedChange={(checked) => { setShowLearningHints(checked); setSavedNotice(true); }} size="md" />}
            stackOnMobile={false}
            title={copy.settings.hintsTitle}
          />

          <SettingRow
            control={(
              <Button
                aria-describedby={resetUnavailable ? "reset-preferences-reason" : undefined}
                disabled={resetUnavailable}
                iconLeading="reset"
                onClick={() => { resetPreferences(); setSavedNotice(true); }}
                size="sm"
                variant="secondary"
              >
                {copy.settings.reset}
              </Button>
            )}
            description={resetUnavailable ? <span key={isHydrated ? "default" : "pending"}>{isHydrated ? copy.settings.nothingToReset : copy.common.storagePending}</span> : undefined}
            descriptionId="reset-preferences-reason"
            stackOnMobile={false}
            title={copy.settings.resetTitle}
          />
        </TransitionPanel>
      </div>
    </div>
  );
}
