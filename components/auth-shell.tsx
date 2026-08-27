"use client";

import Image from "next/image";
import Link from "next/link";

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
    <div className="min-h-screen bg-[#f8f7f7] text-[#171416]">
      <header className="flex h-[72px] items-center justify-between px-11 max-md:px-6">
        <Link aria-label={labels.home} className="flex items-center gap-1" href="/">
          <Image alt="" height={28} priority src={UI_ASSETS.brand.mark} width={28} />
          <span className="text-[15px] font-semibold leading-[22.5px] tracking-[-0.15px]">RAG StepLab</span>
        </Link>
        <div aria-label={labels.language} className="flex h-[34px] items-center gap-0.5 rounded-[10px] border border-[#e7e2e4] bg-white p-1 shadow-sm" role="group">
          {["en", "tr"].map((locale) => (
            <button
              aria-pressed={preferences.locale === locale}
              className={cn(
                "h-[26px] rounded-[7px] px-2.5 text-[12px] font-medium text-[#969093] transition-colors hover:text-[#501329] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25",
                preferences.locale === locale && "bg-[#f2eff0] text-[#171416] shadow-sm",
              )}
              key={locale}
              onClick={() => setLocale(locale as "en" | "tr")}
              type="button"
            >
              {locale.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <main className="flex min-h-[calc(100vh-72px)] items-center justify-center px-6 py-8 max-md:px-4 max-md:py-4">
        <div className="grid w-full max-w-[1040px] overflow-hidden rounded-[24px] border-[1.5px] border-[#e7e2e4] bg-white shadow-[0_20px_40px_rgba(23,20,22,0.07)] md:min-h-[620px] md:grid-cols-2 lg:h-[668px]">
          <section className="relative hidden min-h-[420px] min-w-0 flex-col overflow-hidden bg-[#fdf8f9] p-4 md:flex lg:p-5" data-testid="auth-hero-panel">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-[18px]" data-testid="auth-hero">
              <Image alt={labels.heroAlt} className="object-contain" data-testid="auth-hero-image" fill priority sizes="(max-width: 1023px) 50vw, 520px" src={UI_ASSETS.illustrations.login} />
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
