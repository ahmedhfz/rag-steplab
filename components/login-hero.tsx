"use client";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { type AppCopy, useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

type HeroStepKey = keyof AppCopy["auth"]["hero"]["steps"];

const HERO_STEPS: readonly { key: HeroStepKey; icon: SemanticIconName }[] = [
  { key: "document", icon: "document" },
  { key: "parsing", icon: "parse" },
  { key: "chunking", icon: "chunk" },
  { key: "embedding", icon: "embed" },
  { key: "retrieval", icon: "retrieve" },
  { key: "answer", icon: "generate" },
];

/**
 * Static, code-drawn pipeline for the auth screens: real text (TR/EN), theme
 * tokens and the app's own stage icons. The answer is the single brand accent.
 */
export function LoginHero({ className }: { className?: string }) {
  const hero = useCopy().auth.hero;
  const lastIndex = HERO_STEPS.length - 1;

  return (
    <section aria-labelledby="auth-hero-title" className={cn("flex w-full max-w-sm flex-col gap-8", className)} data-testid="auth-hero">
      <div className="space-y-2">
        <p className="text-2xl font-semibold tracking-tight text-foreground" id="auth-hero-title">{hero.title}</p>
        <p className="text-sm text-muted-foreground">{hero.description}</p>
      </div>
      <ol className="flex flex-col">
        {HERO_STEPS.map((step, index) => {
          const accent = index === lastIndex;
          return (
            <li className="relative flex items-center gap-3 pb-4 last:pb-0" data-testid={`auth-hero-step-${step.key}`} key={step.key}>
              {accent ? null : <span aria-hidden="true" className="absolute bottom-0 left-4.5 top-9 w-px -translate-x-1/2 bg-input/50" />}
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-md border bg-card",
                  accent ? "border-brand-subtle-border text-brand" : "border-border text-muted-foreground",
                )}
              >
                <AppIcon name={step.icon} className="size-4.5" />
              </span>
              <span className="text-sm font-medium text-foreground">{hero.steps[step.key]}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
