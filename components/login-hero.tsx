"use client";

import Image from "next/image";

import heroArt from "@/components/brand/login-hero-pipeline.webp";
import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * Auth hero: a transparent glass illustration of the pipeline (PDF → chunks →
 * vectors → answer) above the real TR/EN headline. The art is decorative; the
 * text carries the meaning. It reads on both the light and dark canvas.
 */
export function LoginHero({ className }: { className?: string }) {
  const hero = useCopy().auth.hero;

  return (
    <section aria-labelledby="auth-hero-title" className={cn("flex w-full max-w-sm flex-col gap-8", className)} data-testid="auth-hero">
      <Image
        alt=""
        aria-hidden="true"
        className="h-auto w-full select-none animate-in fade-in zoom-in-95 fill-mode-both animation-duration-700 motion-reduce:animate-none"
        data-testid="auth-hero-art"
        draggable={false}
        height={602}
        // Above the fold on desktop; eager also lets it complete inside the hidden phone panel,
        // where `sizes` makes the browser fetch only the smallest variant.
        loading="eager"
        // Visible only from md up (the panel is hidden on phones), at most the section width.
        sizes="(min-width: 768px) 24rem, 1px"
        src={heroArt}
        width={803}
      />
      <div>
        <p className="text-display-sm font-semibold text-primary" id="auth-hero-title">{hero.title}</p>
        <p className="mt-3 text-md text-tertiary">{hero.description}</p>
      </div>
    </section>
  );
}
