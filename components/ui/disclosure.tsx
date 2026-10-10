"use client";

import type { ComponentProps, ReactNode } from "react";

import { usePreferences } from "@/components/preferences-provider";
import { AppIcon } from "@/components/ui/app-icon";
import { TransitionDetails } from "@/components/ui/transitions";
import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

export type DisclosureVariant = "section" | "inline";

export type DisclosureProps = Omit<ComponentProps<"details">, "title" | "children"> & {
  /** Summary label. The chevron and native marker handling are owned here. */
  title: ReactNode;
  /** Quiet right-aligned summary meta, e.g. a count. */
  meta?: ReactNode;
  /** `section`: full-width row on a panel surface. `inline`: text-link style toggle. */
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
  const section = variant === "section";
  return (
    <TransitionDetails
      {...props}
      className={cn("group/disclosure", section && "rounded-lg border border-border bg-card", className)}
      data-variant={variant}
      defaultOpen={defaultOpen}
    >
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 transition-colors [&::-webkit-details-marker]:hidden",
          section
            ? "min-h-11 rounded-[inherit] px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface-subtle group-data-[open=true]/disclosure:rounded-b-none"
            : "w-fit text-xs font-medium text-muted-foreground hover:text-foreground",
          summaryClassName,
        )}
      >
        <span className={cn("min-w-0", section && "flex-1")}>{title}</span>
        {meta !== undefined && meta !== null ? <span className="shrink-0 text-xs font-normal text-subtle-foreground tabular-nums">{meta}</span> : null}
        <AppIcon name="chevronDown" className={cn("shrink-0 text-subtle-foreground", section ? "size-4" : "size-3.5")} />
      </summary>
      <div className={cn(section ? "border-t border-border px-4 py-3" : "pt-2", contentClassName)}>{children}</div>
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
      title={<span className="inline-flex items-center gap-1.5"><AppIcon name="lightBulb" className="size-3.5" />{copy.common.howItWorks}</span>}
      variant="inline"
    >
      <div className="max-w-prose text-sm text-muted-foreground" role="note">{children}</div>
    </Disclosure>
  );
}
