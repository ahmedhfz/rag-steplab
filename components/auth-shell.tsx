"use client";

import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { LoginHero } from "@/components/login-hero";
import { usePreferences } from "@/components/preferences-provider";
import { useSlidingIndicator } from "@/components/ui/use-sliding-indicator";
import { useCopy } from "@/lib/copy";

/** Client-side minimum for new passwords; the copy interpolates the same value. */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * EN/TR toggle. Buttons with aria-pressed (not radios): one press switches the whole page.
 * Same look and sliding pill as the SegmentedControl.
 */
function LocaleSwitch() {
  const { preferences, setLocale } = usePreferences();
  const copy = useCopy().auth;
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement>("button[data-selected]");
  return (
    <div aria-label={copy.language} className="relative inline-flex rounded-lg bg-tertiary p-0.5 ring-1 ring-secondary ring-inset dark:bg-secondary_alt" ref={containerRef} role="group">
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 rounded-md bg-primary opacity-0 shadow-sm ring-1 ring-secondary_alt transition-[translate,width,opacity] duration-(--tabs-dur) ease-(--tabs-ease) dark:bg-quaternary" ref={indicatorRef} />
      {(["en", "tr"] as const).map((locale) => {
        const selected = preferences.locale === locale;
        return (
          <button
            aria-pressed={selected}
            className="relative z-10 h-7 min-w-9 cursor-pointer rounded-md px-2.5 text-xs font-semibold text-tertiary transition-colors duration-150 hover:text-secondary data-selected:text-primary"
            data-selected={selected || undefined}
            key={locale}
            onClick={() => setLocale(locale)}
            type="button"
          >
            {locale.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

/** Faint dot grid behind the hero, fading out towards the edges. Decorative. */
function DotGrid() {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full text-border-primary mask-radial-from-15% mask-radial-to-75%">
      <defs>
        <pattern height="22" id="auth-hero-dots" patternUnits="userSpaceOnUse" width="22" x="0" y="0">
          <circle cx="1.5" cy="1.5" fill="currentColor" r="1" />
        </pattern>
      </defs>
      <rect fill="url(#auth-hero-dots)" height="100%" width="100%" />
    </svg>
  );
}

/**
 * Split auth layout: the code-drawn pipeline hero on a dotted canvas (md+) and the form on the
 * panel surface. Both halves are theme tokens, so dark mode is the same composition, not a raster.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const copy = useCopy().auth;

  return (
    <div className="relative min-h-screen bg-primary text-primary">
      <header className="absolute inset-x-0 top-0 z-10 flex h-18 items-center justify-between px-6 md:px-10">
        <Link aria-label={copy.home} className="flex items-center gap-2.5 rounded-md" href="/">
          <BrandMark />
          <span className="text-md font-semibold text-primary">RAG StepLab</span>
        </Link>
        <LocaleSwitch />
      </header>

      <div className="grid min-h-screen md:grid-cols-2">
        <div className="relative hidden min-w-0 items-center justify-center overflow-hidden border-r border-secondary bg-canvas px-10 pt-24 pb-16 md:flex lg:px-16" data-testid="auth-hero-panel">
          <DotGrid />
          <LoginHero className="relative" />
        </div>

        <main className="flex min-w-0 items-center justify-center px-6 pt-28 pb-12 sm:px-10 md:pt-24 md:pb-16">
          {children}
        </main>
      </div>
    </div>
  );
}
