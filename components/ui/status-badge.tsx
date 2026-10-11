"use client";

import type { ComponentProps, ReactNode } from "react";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { IconSwap, SuccessCheck, TransitionText } from "@/components/ui/transitions";
import type { PipelineStepState } from "@/lib/rag-ui-types";
import { cn } from "@/lib/utils";

/*
 * The single status language. Colour discipline:
 *  - brand  = active / now: the next step (ready) and work in progress (processing)
 *  - green  = verified success only (a check that passed, a citation that resolved)
 *  - completed is neutral; idle/queued are grey; amber = warning/stale; red = error.
 */
export type Status = "idle" | "queued" | "ready" | "processing" | "completed" | "success" | "warning" | "stale" | "error";

type StatusMeta = { text: string; dot: string; icon: SemanticIconName; pill: string };

export const STATUS_META: Readonly<Record<Status, StatusMeta>> = {
  idle: { text: "text-quaternary", dot: "ring-1 ring-inset ring-fg-quaternary", icon: "circle", pill: "bg-utility-gray-50 ring-utility-gray-200" },
  queued: { text: "text-tertiary", dot: "bg-fg-quaternary animate-pulse motion-reduce:animate-none", icon: "queued", pill: "bg-utility-gray-50 ring-utility-gray-200" },
  ready: { text: "text-brand-secondary", dot: "bg-fg-brand-primary", icon: "ready", pill: "bg-utility-brand-50 ring-utility-brand-200" },
  processing: { text: "text-brand-secondary", dot: "bg-fg-brand-primary", icon: "loading", pill: "bg-utility-brand-50 ring-utility-brand-200" },
  completed: { text: "text-tertiary", dot: "bg-fg-tertiary", icon: "check", pill: "bg-utility-gray-50 ring-utility-gray-200" },
  success: { text: "text-success-primary", dot: "bg-fg-success-secondary", icon: "completed", pill: "bg-utility-success-50 ring-utility-success-200" },
  warning: { text: "text-warning-primary", dot: "bg-fg-warning-secondary", icon: "warningTriangle", pill: "bg-utility-warning-50 ring-utility-warning-200" },
  stale: { text: "text-warning-primary", dot: "bg-fg-warning-secondary", icon: "history", pill: "bg-utility-warning-50 ring-utility-warning-200" },
  error: { text: "text-error-primary", dot: "bg-fg-error-secondary", icon: "warning", pill: "bg-utility-error-50 ring-utility-error-200" },
};

function Spinner({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={cn("shrink-0 animate-spin motion-reduce:animate-none", className)} fill="none" viewBox="0 0 16 16">
      <circle className="stroke-current opacity-25" cx="8" cy="8" r="6" strokeWidth="2" />
      <path className="stroke-current" d="M14 8a6 6 0 0 0-6-6" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

export type StatusBadgeProps = Omit<ComponentProps<"span">, "children"> & {
  status: Status;
  /** Visible label. For `icon` appearance it becomes the accessible name. */
  children: ReactNode;
  /** `inline`: dot + text, frameless (default, for prose and rows). `pill`: tinted chip (tables, headers). `icon`: icon only, label is sr-only. */
  appearance?: "inline" | "pill" | "icon";
  /** Override the status icon (icon appearance only). */
  icon?: SemanticIconName;
};

/** One component for every run, step and document status. */
export function StatusBadge({ status, children, appearance = "inline", icon, className, ...props }: StatusBadgeProps) {
  const meta = STATUS_META[status];
  const marker = status === "processing"
    ? <Spinner className="size-3" />
    : <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />;
  const label = typeof children === "string" ? <TransitionText>{children}</TransitionText> : children;

  if (appearance === "icon") {
    const name = icon ?? meta.icon;
    return (
      <span {...props} className={cn("inline-grid size-4 shrink-0 place-items-center", meta.text, className)} data-status={status} title={typeof children === "string" ? children : undefined}>
        {status === "processing" && name === "loading" ? <Spinner className="size-3.5" /> : <AppIcon className="size-3.5" name={name} />}
        <span className="sr-only">{children}</span>
      </span>
    );
  }

  return (
    <span
      {...props}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 text-xs font-medium whitespace-nowrap",
        meta.text,
        appearance === "pill" && cn("h-5.5 rounded-full px-2 ring-1 ring-inset", meta.pill),
        className,
      )}
      data-status={status}
    >
      {marker}
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Legacy tone API (pre-redesign screens). Maps onto the status above. */

/** @deprecated Use `Status` with StatusBadge. */
export type StatusTone = "neutral" | "next" | "running" | "warning" | "error" | "idle";

export const TONE_STATUS: Readonly<Record<StatusTone, Status>> = {
  neutral: "completed",
  next: "ready",
  running: "processing",
  warning: "warning",
  error: "error",
  idle: "idle",
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
  return <StatusBadge {...props} className={className} data-tone={tone} status={TONE_STATUS[tone]}>{children}</StatusBadge>;
}

/** Icon-only status with an accessible (sr-only + title) label. Completed draws its check in. */
export function StatusIcon({ tone, label, icon, className }: { tone: StatusTone; label: string; icon?: SemanticIconName; className?: string }) {
  const status = TONE_STATUS[tone];
  const name = icon ?? STATUS_META[status].icon;
  return (
    <span className={cn("inline-grid size-4 shrink-0 place-items-center", STATUS_META[status].text, className)} data-status={status} data-tone={tone} title={label}>
      <IconSwap
        active={tone === "neutral"}
        first={tone === "running" && name === "loading" ? <Spinner className="size-3.5" /> : <AppIcon className="size-3.5" name={tone === "neutral" ? "circle" : name} />}
        second={tone === "neutral" ? <SuccessCheck className="size-3.5" /> : null}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
