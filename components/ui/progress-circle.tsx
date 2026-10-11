import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * ProgressCircle — derived from Tremor Raw ProgressCircle v0.0.3 (Apache-2.0,
 * github.com/tremorlabs/tremor, src/components/ProgressCircle). Modified: StepLab tones,
 * no tailwind-variants dependency, accessible label prop, eased stroke animation.
 * Use for a single ratio with a centred readout (coverage, faithfulness, cases passed).
 */

export type ProgressCircleTone = "brand" | "gray" | "success" | "warning" | "error";

const tones: Record<ProgressCircleTone, string> = {
  brand: "stroke-fg-brand-primary",
  gray: "stroke-fg-quaternary",
  success: "stroke-fg-success-secondary",
  warning: "stroke-fg-warning-secondary",
  error: "stroke-fg-error-secondary",
};

export type ProgressCircleProps = Omit<ComponentProps<"div">, "children"> & {
  value: number;
  max?: number;
  radius?: number;
  strokeWidth?: number;
  tone?: ProgressCircleTone;
  /** Accessible name. */
  label: string;
  /** Centred content, e.g. <MetricValue/>. */
  children?: ReactNode;
};

export function ProgressCircle({ value, max = 100, radius = 32, strokeWidth = 6, tone = "brand", label, className, children, ...props }: ProgressCircleProps) {
  const safe = Math.min(max, Math.max(value, 0));
  const r = radius - strokeWidth / 2;
  const circumference = r * 2 * Math.PI;
  const offset = circumference - (safe / max) * circumference;
  return (
    <div {...props} aria-label={label} aria-valuemax={max} aria-valuemin={0} aria-valuenow={value} className={cn("relative inline-grid place-items-center", className)} data-slot="progress-circle" role="progressbar">
      <svg className="-rotate-90" height={radius * 2} viewBox={`0 0 ${radius * 2} ${radius * 2}`} width={radius * 2}>
        <circle className="stroke-bg-quaternary" cx={radius} cy={radius} fill="transparent" r={r} strokeLinecap="round" strokeWidth={strokeWidth} />
        <circle
          className={cn("transition-[stroke-dashoffset] duration-700 ease-out", tones[tone])}
          cx={radius}
          cy={radius}
          fill="transparent"
          r={r}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
        />
      </svg>
      {children ? <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-primary tabular-nums">{children}</div> : null}
    </div>
  );
}
