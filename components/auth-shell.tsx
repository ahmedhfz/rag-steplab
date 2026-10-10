"use client";

import { SlidingTabs } from "@/components/ui/transitions";

import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { LoginHero } from "@/components/login-hero";
import { usePreferences } from "@/components/preferences-provider";
import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

export function AuthShell({ children }: { children: React.ReactNode }) {
  const { preferences, setLocale } = usePreferences();
  const copy = useCopy().auth;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-[72px] items-center justify-between px-11 max-md:px-6">
        <Link aria-label={copy.home} className="flex items-center gap-2.5" href="/">
          <BrandMark />
          <span className="text-base font-semibold tracking-tight">RAG StepLab</span>
        </Link>
        <SlidingTabs value={preferences.locale} aria-label={copy.language} className="steplab-auth-tabs flex h-8 items-center gap-0.5 rounded-md border border-border bg-card p-1 shadow-xs" role="group">
          {["en", "tr"].map((locale) => (
            <button
              aria-pressed={preferences.locale === locale}
              className={cn(
                "h-6 rounded-sm px-2.5 text-xs font-medium text-subtle-foreground transition-colors hover:text-foreground",
                preferences.locale === locale && "bg-secondary text-foreground shadow-sm",
              )}
              key={locale}
              onClick={() => setLocale(locale as "en" | "tr")}
              type="button"
            >
              {locale.toUpperCase()}
            </button>
          ))}
        </SlidingTabs>
      </header>

      <main className="flex min-h-[calc(100vh-72px)] items-center justify-center px-6 py-8 max-md:px-4 max-md:py-4">
        {/* Content-sized card: the minimum height only keeps the two columns balanced; zoom and long messages grow it. */}
        <div className="grid w-full max-w-[1040px] overflow-hidden rounded-xl border border-border bg-card shadow-[0_20px_40px_rgba(23,20,22,0.07)] md:min-h-[620px] md:grid-cols-2 lg:min-h-[668px]">
          <div className="hidden min-w-0 items-center justify-center border-r border-border bg-surface-subtle p-12 md:flex lg:px-16" data-testid="auth-hero-panel">
            <LoginHero />
          </div>

          <section className="flex min-w-0 items-center justify-center px-20 py-10 max-lg:px-8 max-md:px-6 max-md:py-8">
            {children}
          </section>
        </div>
      </main>
    </div>
  );
}
