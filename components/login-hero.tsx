"use client";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { useCopy } from "@/lib/copy";
import type { PipelineStepKey } from "@/lib/rag-ui-types";
import { cn } from "@/lib/utils";

/** The learning path from PDF to answer; labels come from the Overview journey so names match everywhere. */
const HERO_STEPS: readonly { key: PipelineStepKey; icon: SemanticIconName }[] = [
  { key: "document", icon: "document" },
  { key: "parse", icon: "parse" },
  { key: "chunk", icon: "chunk" },
  { key: "embed", icon: "embed" },
  { key: "retrieve", icon: "retrieve" },
  { key: "generate", icon: "generate" },
];

/** Staggered entrance, one step after another (reduced motion: no animation). */
const ENTRANCE_DELAYS = ["delay-0", "delay-75", "delay-150", "delay-225", "delay-300", "delay-375"] as const;

/**
 * Static, code-drawn pipeline for the auth screens: real text (TR/EN), theme
 * tokens and the app's own stage icons. The answer is the single brand accent.
 */
export function LoginHero({ className }: { className?: string }) {
  const copy = useCopy();
  const hero = copy.auth.hero;
  const stepLabels = copy.overview.journey.steps;
  const lastIndex = HERO_STEPS.length - 1;

  return (
    <section aria-labelledby="auth-hero-title" className={cn("flex w-full max-w-sm flex-col gap-10", className)} data-testid="auth-hero">
      <div>
        <p className="text-display-sm font-semibold text-primary" id="auth-hero-title">{hero.title}</p>
        <p className="mt-3 text-md text-tertiary">{hero.description}</p>
      </div>
      <ol className="flex flex-col gap-3">
        {HERO_STEPS.map((step, index) => {
          const accent = index === lastIndex;
          return (
            <li
              className={cn(
                "relative flex items-center gap-3.5 animate-in fade-in slide-in-from-left-2 fill-mode-both animation-duration-500 motion-reduce:animate-none",
                ENTRANCE_DELAYS[index],
              )}
              data-testid={`auth-hero-step-${step.key}`}
              key={step.key}
            >
              {accent ? null : <span aria-hidden="true" className="absolute top-10 left-5 h-3 w-px -translate-x-1/2 bg-border-primary" />}
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-xl ring-1 ring-inset",
                  accent
                    ? "bg-brand-primary text-fg-brand-primary shadow-sm ring-utility-brand-200"
                    : "bg-primary text-fg-tertiary shadow-xs ring-secondary",
                )}
              >
                <AppIcon name={step.icon} className="size-5" />
              </span>
              <span className={cn("text-sm", accent ? "font-semibold text-primary" : "font-medium text-secondary")}>{stepLabels[step.key]}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
