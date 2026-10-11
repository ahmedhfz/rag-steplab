import type { ComponentProps, ReactNode } from "react";

import { AppIcon } from "@/components/ui/app-icon";
import { cn } from "@/lib/utils";

/*
 * ProgressBar — Untitled UI React `components/base/progress-indicators/progress-indicators.tsx` (MIT).
 * Stepper — built here (Untitled "progress steps" is PRO).
 * Colour discipline: brand = work happening now; success only when a check verified something.
 */

export type ProgressTone = "brand" | "gray" | "success" | "warning" | "error";

const fills: Record<ProgressTone, string> = {
  brand: "bg-fg-brand-primary",
  gray: "bg-fg-quaternary",
  success: "bg-fg-success-secondary",
  warning: "bg-fg-warning-secondary",
  error: "bg-fg-error-secondary",
};

export type ProgressBarProps = Omit<ComponentProps<"div">, "children"> & {
  /** Omit for an indeterminate sweep. */
  value?: number;
  min?: number;
  max?: number;
  tone?: ProgressTone;
  size?: "sm" | "md";
  /** Accessible name (also shown when `showValue` is used with a visible label). */
  label: string;
  /** Visible label row above the bar. */
  showLabel?: boolean;
  /** Show the formatted value at the end of the label row. */
  showValue?: boolean;
  valueFormatter?: (value: number, percent: number) => ReactNode;
};

export function ProgressBar({ value, min = 0, max = 100, tone = "brand", size = "sm", label, showLabel = false, showValue = false, valueFormatter, className, ...props }: ProgressBarProps) {
  const indeterminate = value === undefined;
  const percent = indeterminate ? 0 : Math.min(100, Math.max(0, ((value - min) * 100) / (max - min || 1)));
  const formatted = indeterminate ? null : valueFormatter ? valueFormatter(value, percent) : `${Math.round(percent)}%`;
  return (
    <div {...props} className={cn("flex w-full min-w-0 flex-col gap-2", className)} data-slot="progress">
      {showLabel || showValue ? (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          {showLabel ? <span className="truncate font-medium text-secondary">{label}</span> : <span />}
          {showValue && formatted !== null ? <span className="shrink-0 font-medium text-tertiary tabular-nums">{formatted}</span> : null}
        </div>
      ) : null}
      <div
        aria-label={label}
        aria-valuemax={indeterminate ? undefined : max}
        aria-valuemin={indeterminate ? undefined : min}
        aria-valuenow={indeterminate ? undefined : value}
        className={cn("relative w-full overflow-hidden rounded-full bg-quaternary", size === "md" ? "h-2" : "h-1.5")}
        role="progressbar"
      >
        <div
          className={cn(
            "h-full rounded-full",
            fills[tone],
            indeterminate ? "w-2/5 animate-progress-indeterminate motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-40" : "transition-[width] duration-500 ease-out",
          )}
          style={indeterminate ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/* --------------------------------- Stepper --------------------------------- */

export type StepState = "complete" | "current" | "upcoming" | "error";

export type StepperStep = {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  state: StepState;
};

export type StepperProps = Omit<ComponentProps<"ol">, "children"> & {
  steps: ReadonlyArray<StepperStep>;
  orientation?: "horizontal" | "vertical";
  /** Accessible name for the list. */
  "aria-label": string;
};

function StepMarker({ state, index }: { state: StepState; index: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative z-10 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors duration-200",
        state === "complete" && "bg-tertiary text-fg-secondary",
        state === "current" && "bg-brand-solid text-white shadow-xs ring-4 ring-utility-brand-100",
        state === "upcoming" && "bg-primary text-quaternary ring-1 ring-primary ring-inset",
        state === "error" && "bg-error-solid text-white ring-4 ring-utility-error-100",
      )}
    >
      {state === "complete" ? <AppIcon className="size-3.5" name="check" strokeWidth={2.25} /> : state === "error" ? <AppIcon className="size-3.5" name="close" strokeWidth={2.25} /> : index + 1}
    </span>
  );
}

/** Numbered progress steps. Completed steps stay neutral; only the current step is brand. */
export function Stepper({ steps, orientation = "horizontal", className, ...props }: StepperProps) {
  const vertical = orientation === "vertical";
  return (
    <ol {...props} className={cn("flex", vertical ? "flex-col" : "w-full items-start", className)} data-slot="stepper">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn("relative flex min-w-0", vertical ? "gap-3 pb-6 last:pb-0" : "flex-1 flex-col items-start gap-2 pr-3")}
            data-state={step.state}
            key={step.id}
          >
            {!last ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute bg-border-secondary",
                  vertical ? "top-7 bottom-1 left-3 w-px" : "top-3 right-1 left-8 h-px",
                  step.state === "complete" && "bg-fg-quaternary",
                )}
              />
            ) : null}
            <StepMarker index={index} state={step.state} />
            <span className={cn("min-w-0", vertical && "pt-0.5")}>
              <span className={cn("block truncate text-sm font-semibold", step.state === "current" ? "text-brand-secondary" : step.state === "upcoming" ? "text-tertiary" : step.state === "error" ? "text-error-primary" : "text-secondary")}>{step.label}</span>
              {step.description ? <span className="mt-0.5 block text-sm text-tertiary">{step.description}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
