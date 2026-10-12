"use client";

import type { ComponentProps, ReactNode } from "react";
import NumberFlow, { NumberFlowGroup, type Format } from "@number-flow/react";

import { AppIcon } from "@/components/ui/app-icon";
import { usePreferences } from "@/components/preferences-provider";
import { cn } from "@/lib/utils";

/*
 * Metric / Stat — Untitled UI "metrics" layout idea, built here (the Untitled metric cards are PRO).
 * Numbers animate with NumberFlow (number-flow.barvian.me, MIT): digits roll, width stays
 * stable (tabular), and reduced motion falls back to an instant swap.
 */

export type MetricValueProps = Omit<ComponentProps<"span">, "children"> & {
  value: number | null | undefined;
  format?: Format;
  prefix?: string;
  suffix?: string;
  /** Text shown when value is null/undefined. */
  placeholder?: string;
  /** Overrides the app-language number notation (e.g. "en-US" for scores shown as 0.50 everywhere). */
  locales?: string;
};

/** An animated, tabular number for inline use (table cells, headers, chips). */
export function MetricValue({ value, format, prefix, suffix, placeholder = "—", locales, className, ...props }: MetricValueProps) {
  const { preferences } = usePreferences();
  const locale = locales ?? (preferences.locale === "tr" ? "tr-TR" : "en-US");
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span {...props} className={cn("tabular-nums", className)} data-slot="metric-value">{placeholder}</span>;
  }
  // NumberFlow renders digits in shadow DOM, so assistive tech and text queries read the sr-only copy.
  const text = `${prefix ?? ""}${new Intl.NumberFormat(locale, format).format(value)}${suffix ?? ""}`;
  return (
    <span {...props} className={cn("tabular-nums", className)} data-slot="metric-value">
      <span className="sr-only">{text}</span>
      <NumberFlow aria-hidden="true" format={format} locales={locale} prefix={prefix} suffix={suffix} value={value} willChange />
    </span>
  );
}

export type MetricDelta = {
  value: number;
  format?: Format;
  /** Unit after the delta; defaults to the metric suffix. */
  suffix?: string;
  /** Whether an increase is good. Default true. */
  higherIsBetter?: boolean;
  label?: ReactNode;
};

export type MetricProps = Omit<ComponentProps<"div">, "children"> & MetricValueProps & {
  label: ReactNode;
  delta?: MetricDelta;
  /** Quiet supporting line under the value. */
  hint?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Optional trailing visual (SparkChart, ProgressCircle). */
  visual?: ReactNode;
};

const valueSizes = { sm: "text-lg", md: "text-display-xs", lg: "text-display-sm" };

export function Metric({ label, value, format, prefix, suffix, placeholder, delta, hint, size = "md", visual, className, ...props }: MetricProps) {
  const trend = delta ? Math.sign(delta.value) : 0;
  const good = delta ? (delta.higherIsBetter ?? true) === trend > 0 : false;
  return (
    <div {...props} className={cn("flex min-w-0 items-start justify-between gap-4", className)} data-slot="metric">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-tertiary">{label}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <MetricValue className={cn("font-semibold text-primary", valueSizes[size])} format={format} placeholder={placeholder} prefix={prefix} suffix={suffix} value={value} />
          {delta ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-sm font-medium tabular-nums",
                trend === 0 ? "text-tertiary" : good ? "text-success-primary" : "text-error-primary",
              )}
              data-trend={trend > 0 ? "up" : trend < 0 ? "down" : "flat"}
            >
              {trend !== 0 ? <AppIcon className="size-3.5" name={trend > 0 ? "trendUp" : "trendDown"} strokeWidth={2} /> : null}
              <MetricValue format={delta.format ?? format} suffix={delta.suffix ?? suffix} value={Math.abs(delta.value)} />
              {delta.label ? <span className="ml-1 font-normal text-quaternary">{delta.label}</span> : null}
            </span>
          ) : null}
        </div>
        {hint ? <p className="mt-1 text-sm text-quaternary">{hint}</p> : null}
      </div>
      {visual ? <div className="shrink-0 self-center">{visual}</div> : null}
    </div>
  );
}

/**
 * Stat strip (the "result summary" pattern). Children are Metrics.
 * Default is frameless with hairline dividers — put it inside a Panel or directly on the canvas.
 * `framed` joins the cells into one quiet card for a standalone summary.
 */
export function MetricGroup({ framed = false, className, children, ...props }: ComponentProps<"div"> & { framed?: boolean }) {
  return (
    <NumberFlowGroup>
      <div
        {...props}
        className={cn(
          framed
            ? "grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border-secondary shadow-xs ring-1 ring-secondary sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none *:bg-primary *:px-5 *:py-4"
            : "grid grid-cols-2 gap-x-6 gap-y-5 sm:flex sm:flex-wrap sm:gap-0 sm:*:border-l sm:*:border-secondary sm:*:px-6 sm:*:first:border-l-0 sm:*:first:pl-0",
          className,
        )}
        data-slot="metric-group"
      >
        {children}
      </div>
    </NumberFlowGroup>
  );
}
