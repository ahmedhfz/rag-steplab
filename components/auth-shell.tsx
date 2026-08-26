"use client";

import Image from "next/image";
import Link from "next/link";
import { Check, ImageIcon } from "lucide-react";

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
        title: "RAG'inizin her adımını anlayın.",
        description: "RAG pipeline'ınızı güvenle oluşturun, inceleyin ve değerlendirin.",
        features: [
          ["Gerçek parsing", "Yapıyı ve anlamı hassasiyetle çıkarın."],
          ["İncelenebilir retrieval", "Her adımda chunk'ları, bağlamı ve kaynakları görün."],
          ["Ölçülebilir evaluation", "RAG'inizi anlamlı metriklerle değerlendirin."],
        ],
        asset: "ASSET / LOGIN / HERO",
      }
    : {
        home: "RAG StepLab home",
        language: "Language",
        title: "Understand every step of your RAG.",
        description: "Build, inspect, and evaluate your RAG pipeline with confidence.",
        features: [
          ["Real parsing", "Extract structure and meaning with precision."],
          ["Inspectable retrieval", "See chunks, context, and sources at every step."],
          ["Measurable evaluation", "Evaluate your RAG with metrics that matter."],
        ],
        asset: "ASSET / LOGIN / HERO",
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

      <main className="flex min-h-[calc(100vh-72px)] items-center justify-center px-6 py-8 max-md:px-4">
        <div className="grid w-full max-w-[1040px] overflow-hidden rounded-[24px] border-[1.712px] border-[#e7e2e4] bg-white shadow-[0_20px_40px_rgba(23,20,22,0.07)] lg:h-[668px] lg:grid-cols-2">
          <section className="flex flex-col bg-[#fdf8f9] px-10 py-10 max-md:px-6 max-md:py-8">
            <div>
              <h1 className="max-w-[380px] text-[30px] font-semibold leading-[36px] tracking-[-0.75px] text-[#171416]">{labels.title}</h1>
              <p className="mt-3 max-w-[370px] text-[14px] leading-[21px] text-[#6e676a]">{labels.description}</p>
            </div>

            <div className="mt-8 space-y-4">
              {labels.features.map(([title, description]) => (
                <div className="flex gap-3" key={title}>
                  <span aria-hidden="true" className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#f3d9e0] text-[#711f3a]"><Check className="size-3" strokeWidth={2} /></span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold leading-[19px] text-[#171416]">{title}</p>
                    <p className="text-[13px] leading-[19px] text-[#6e676a]">{description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-auto flex h-[246px] flex-none items-center justify-center rounded-[16px] border-[1.5px] border-dashed border-[#d8d2d5] bg-white/30">
              <div className="flex flex-col items-center gap-3 text-center">
                <span className="grid size-11 place-items-center rounded-[10px] border border-[#e7e2e4] bg-white text-[#711f3a] shadow-sm"><ImageIcon aria-hidden="true" className="size-[18px]" strokeWidth={1.5} /></span>
                <span className="font-mono text-[10px] tracking-[0.07em] text-[#969093]">{labels.asset}</span>
              </div>
            </div>
          </section>

          <section className="flex items-center justify-center px-20 py-10 max-md:px-6">
            {children}
          </section>
        </div>
      </main>
    </div>
  );
}
