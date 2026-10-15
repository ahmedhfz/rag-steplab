"use client";

import type { ComponentProps, ReactNode } from "react";

import { usePreferences } from "@/components/preferences-provider";
import { AppIcon } from "@/components/ui/app-icon";
import { TransitionDetails } from "@/components/ui/transitions";
import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/**
 * - `section`: a standalone collapsible block with its own quiet frame (on the canvas).
 * - `plain`: a frameless row with a hairline divider — use inside a Panel (no box-in-box).
 * - `inline`: a text-link toggle for secondary detail ("Technical details", "How it works").
 */
export type DisclosureVariant = "section" | "plain" | "inline";

export type DisclosureProps = Omit<ComponentProps<"details">, "title" | "children"> & {
  /** Summary label. The chevron and native marker handling are owned here. */
  title: ReactNode;
  /** Quiet right-aligned summary meta, e.g. a count. */
  meta?: ReactNode;
  variant?: DisclosureVariant;
  defaultOpen?: boolean;
  summaryClassName?: string;
  contentClassName?: string;
  children: ReactNode;
};

/**
 * The single disclosure pattern. Native <details>/<summary> keeps keyboard
 * semantics; TransitionDetails adds the 21-accordion recipe.
 */
export function Disclosure({ title, meta, variant = "section", defaultOpen, className, summaryClassName, contentClassName, children, ...props }: DisclosureProps) {
  const inline = variant === "inline";
  return (
    <TransitionDetails
      {...props}
      className={cn(
        "group/disclosure",
        variant === "section" && "rounded-xl bg-primary ring-1 ring-secondary",
        variant === "plain" && "border-b border-secondary last:border-b-0",
        className,
      )}
      data-variant={variant}
      defaultOpen={defaultOpen}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 transition-colors duration-150 select-none [&::-webkit-details-marker]:hidden",
          variant === "section" && "min-h-11 rounded-[inherit] px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary_hover group-data-[open=true]/disclosure:rounded-b-none",
          variant === "plain" && "min-h-11 py-2.5 text-sm font-semibold text-primary hover:text-secondary_hover",
          // ::before grows the 18–23px text row to a >=24px hit area (WCAG 2.5.8) without moving layout;
          // positioned children paint above it, so it only adds the extra rows and never covers them.
          inline && "relative w-fit rounded-sm text-sm font-medium text-tertiary before:absolute before:inset-x-0 before:-inset-y-1 *:relative hover:text-secondary",
          summaryClassName,
        )}
      >
        <span className={cn("min-w-0", !inline && "flex-1")}>{title}</span>
        {meta !== undefined && meta !== null ? <span className="shrink-0 text-xs font-medium text-quaternary tabular-nums">{meta}</span> : null}
        <AppIcon name="chevronDown" className={cn("shrink-0 text-fg-quaternary", inline ? "size-3.5" : "size-4")} />
      </summary>
      <div className={cn(variant === "section" && "border-t border-secondary px-4 py-3", variant === "plain" && "pb-4", inline && "pt-2", contentClassName)}>{children}</div>
    </TransitionDetails>
  );
}

/** Inline "Technical details" disclosure for raw IDs, durations and config. */
export function TechnicalDetails({ title, children, ...props }: Omit<DisclosureProps, "title" | "variant"> & { title?: ReactNode }) {
  const copy = useCopy();
  return <Disclosure {...props} title={title ?? copy.common.technicalDetails} variant="inline">{children}</Disclosure>;
}

/** Neutral learning disclosure ("How it works"); hidden when learning hints are off. */
export function HowItWorks({ children, className, defaultOpen }: { children: ReactNode; className?: string; defaultOpen?: boolean }) {
  const { preferences } = usePreferences();
  const copy = useCopy();
  if (!preferences.showLearningHints) return null;
  return (
    <Disclosure
      className={className}
      data-testid="how-it-works"
      defaultOpen={defaultOpen}
      title={<span className="inline-flex items-center gap-1.5"><AppIcon name="lightBulb" className="size-4 text-fg-brand-secondary" />{copy.common.howItWorks}</span>}
      variant="inline"
    >
      <div className="max-w-prose text-sm text-tertiary" role="note">{children}</div>
    </Disclosure>
  );
}
