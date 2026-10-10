"use client";

import { SlidingTabs } from "@/components/ui/transitions";

import Image from "next/image";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { usePreferences } from "@/components/preferences-provider";
import { UI_ASSETS } from "@/lib/ui-assets";
import { cn } from "@/lib/utils";

export function AuthShell({ children }: { children: React.ReactNode }) {
  const { preferences, setLocale } = usePreferences();
  const labels = preferences.locale === "tr"
    ? {
        home: "RAG StepLab ana sayfa",
        language: "Dil",
        heroAlt: "Dokümandan cevaba RAG pipeline aşamalarını gösteren RAG StepLab illüstrasyonu.",
      }
    : {
        home: "RAG StepLab home",
        language: "Language",
        heroAlt: "RAG StepLab illustration showing the RAG pipeline from document to answer.",
      };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-[72px] items-center justify-between px-11 max-md:px-6">
        <Link aria-label={labels.home} className="flex items-center gap-1" href="/">
          <BrandMark />
          <span className="text-base font-semibold tracking-tight">RAG StepLab</span>
        </Link>
        <SlidingTabs value={preferences.locale} aria-label={labels.language} className="steplab-auth-tabs flex h-8 items-center gap-0.5 rounded-md border border-border bg-card p-1 shadow-xs" role="group">
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
        <div className="grid w-full max-w-[1040px] overflow-hidden rounded-xl border border-border bg-card shadow-[0_20px_40px_rgba(23,20,22,0.07)] md:min-h-[620px] md:grid-cols-2 lg:h-[668px]">
          <section className="relative hidden min-h-[420px] min-w-0 flex-col overflow-hidden bg-accent p-4 md:flex lg:p-5" data-testid="auth-hero-panel">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl" data-testid="auth-hero">
              <Image alt={labels.heroAlt} className="object-contain" data-testid="auth-hero-image" fill priority sizes="(max-width: 1023px) 50vw, 520px" src={preferences.locale === "tr" ? UI_ASSETS.illustrations.login : UI_ASSETS.illustrations.loginEn} />
            </div>
          </section>

          <section className="flex min-w-0 items-center justify-center px-20 py-10 max-lg:px-8 max-md:px-6 max-md:py-8">
            {children}
          </section>
        </div>
      </main>
    </div>
  );
}

