"use client";

import type { ComponentProps, ReactNode } from "react";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { IconSwap, SuccessCheck, TransitionText } from "@/components/ui/transitions";
import type { PipelineStepState } from "@/lib/rag-ui-types";
import { cn } from "@/lib/utils";

/**
 * Emphasis discipline: brand only for the next step; completed is neutral;
 * pending/locked is grey; amber for running or stale; destructive for errors.
 */
export type StatusTone = "neutral" | "next" | "running" | "warning" | "error" | "idle";

const toneText: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  next: "text-brand",
  running: "text-warning",
  warning: "text-warning",
  error: "text-destructive",
  idle: "text-subtle-foreground",
};

const toneDot: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  next: "bg-brand",
  running: "bg-warning",
  warning: "bg-warning",
  error: "bg-destructive",
  idle: "border border-subtle-foreground",
};

const toneIcon: Record<StatusTone, SemanticIconName> = {
  neutral: "check",
  next: "ready",
  running: "loading",
  warning: "history",
  error: "warning",
  idle: "circle",
};

export type StatusPresentation = { tone: StatusTone; icon?: SemanticIconName };

/** Pipeline step states mapped onto the shared tones. */
export const PIPELINE_STEP_STATUS: Readonly<Record<PipelineStepState, StatusPresentation>> = {
  Completed: { tone: "neutral" },
  Ready: { tone: "next" },
  Processing: { tone: "running" },
  Error: { tone: "error" },
  Stale: { tone: "warning", icon: "history" },
  Skipped: { tone: "idle", icon: "minus" },
  Locked: { tone: "idle", icon: "lock" },
  "Not started": { tone: "idle", icon: "circle" },
};

/** Only exceptional states earn visible status text; the rest stay icon-only. */
export function isExceptionTone(tone: StatusTone) {
  return tone === "running" || tone === "warning" || tone === "error";
}

/** Dot + text, frameless. Use for exceptions (Processing/Error/Stale/Inspecting). */
export function StatusPill({ tone, children, className, ...props }: ComponentProps<"span"> & { tone: StatusTone; children: ReactNode }) {
  return (
    <span {...props} className={cn("inline-flex items-center gap-1.5 text-xs font-medium", toneText[tone], className)} data-tone={tone}>
      {tone === "running"
        ? <AppIcon name="loading" className="size-3 shrink-0 animate-spin motion-reduce:animate-none" />
        : <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", toneDot[tone])} />}
      {typeof children === "string" ? <TransitionText>{children}</TransitionText> : children}
    </span>
  );
}

/** Icon-only status with an accessible (sr-only + title) label. */
export function StatusIcon({ tone, label, icon, className }: { tone: StatusTone; label: string; icon?: SemanticIconName; className?: string }) {
  const name = icon ?? toneIcon[tone];
  const spin = tone === "running" && name === "loading";
  return (
    <span className={cn("inline-grid size-4 shrink-0 place-items-center", toneText[tone], className)} data-tone={tone} title={label}>
      <IconSwap
        active={tone === "neutral"}
        first={<AppIcon name={tone === "neutral" ? "circle" : name} className={cn("size-3.5", spin && "animate-spin motion-reduce:animate-none")} />}
        second={tone === "neutral" ? <SuccessCheck className="size-3.5" /> : null}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
