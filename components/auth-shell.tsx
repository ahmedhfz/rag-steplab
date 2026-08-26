"use client";

import Image from "next/image";
import Link from "next/link";

import { usePreferences } from "@/components/preferences-provider";
import { UI_ASSETS } from "@/lib/ui-assets";
import { cn } from "@/lib/utils";

export function AuthShell({ children }: { children: React.ReactNode }) {
  const { preferences, setLocale } = usePreferences();
  const isTurkish = preferences.locale === "tr";
  const labels = isTurkish
    ? {
        home: "RAG StepLab ana sayfa",
        language: "Dil",
        eyebrow: "RAG öğrenme laboratuvarı",
        title: "RAG pipeline'ını adım adım anlayın.",
        description: "Dokümanınızı gerçek pipeline'dan geçirip her aşamanın girdisini, çıktısını ve kararlarını inceleyin.",
        stages: ["Parse", "Chunk", "Retrieve", "Evaluate"],
        footer: "RAG learning workspace",
      }
    : {
        home: "RAG StepLab home",
        language: "Language",
        eyebrow: "RAG learning laboratory",
        title: "Understand your RAG pipeline, step by step.",
        description: "Run a real document through the pipeline and inspect the inputs, outputs, and decisions at every stage.",
        stages: ["Parse", "Chunk", "Retrieve", "Evaluate"],
        footer: "RAG learning workspace",
      };

  return (
    <div className="min-h-screen bg-[#f8f7f7] text-[#171416]">
      <header className="flex h-[72px] items-center justify-between border-b border-[#e7e2e4] bg-white px-5 sm:px-8">
        <Link aria-label={labels.home} className="flex items-center gap-3" href="/">
          <Image alt="" height={30} priority src={UI_ASSETS.brand.mark} width={30} />
          <span className="text-[17px] font-semibold tracking-[-0.035em]">RAG StepLab</span>
        </Link>
        <div aria-label={labels.language} className="flex items-center gap-1 rounded-[8px] border border-[#e7e2e4] bg-white p-1" role="group">
          {(["en", "tr"] as const).map((locale) => (
            <button
              aria-pressed={preferences.locale === locale}
              className={cn(
                "rounded-[6px] px-2.5 py-1 text-[11px] font-medium text-[#969093] transition-colors hover:text-[#501329] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25",
                preferences.locale === locale && "bg-[#fbf4f6] text-[#711f3a]",
              )}
              key={locale}
              onClick={() => setLocale(locale)}
              type="button"
            >
              {locale.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-122px)] max-w-[1440px] lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.78fr)]">
        <section className="relative hidden overflow-hidden border-r border-[#e7e2e4] px-10 py-12 lg:flex lg:flex-col lg:justify-between xl:px-16">
          <Image alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.18]" fill priority={false} sizes="(min-width: 1024px) 55vw, 0px" src={UI_ASSETS.illustrations.login} />
          <div className="relative max-w-[520px]">
            <p className="inline-flex rounded-full border border-[#d8d2d5] bg-white/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.13em] text-[#711f3a] backdrop-blur-sm">{labels.eyebrow}</p>
            <h1 className="mt-6 max-w-[480px] text-4xl font-semibold leading-[1.08] tracking-[-0.055em] xl:text-5xl">{labels.title}</h1>
            <p className="mt-5 max-w-[460px] text-sm leading-6 text-[#6e676a]">{labels.description}</p>
          </div>
          <div className="relative grid max-w-[540px] grid-cols-4 gap-2">
            {labels.stages.map((stage, index) => (
              <div className="border border-[#e7e2e4] bg-white/85 p-3 backdrop-blur-sm" key={stage}>
                <span className="text-[10px] font-medium text-[#969093]">0{index + 1}</span>
                <span className="mt-5 block text-xs font-semibold text-[#501329]">{stage}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="flex items-center justify-center px-5 py-10 sm:px-8 lg:px-12 xl:px-20">{children}</section>
      </main>

      <footer className="flex min-h-[50px] items-center justify-center border-t border-[#e7e2e4] bg-white px-4 text-[11px] text-[#969093]">{labels.footer}</footer>
    </div>
  );
}
