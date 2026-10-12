import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/*
 * Spinner — Untitled UI React `components/application/loading-indicator` "line-simple" (MIT).
 * Brand stroke = "working now". With `label` it is a polite status region; without, decorative.
 * Short waits only (< ~2s or unknown); use Skeleton when the content shape is known and
 * ProgressBar when progress is measurable.
 */

const sizes = { xs: "size-3.5", sm: "size-4", md: "size-5", lg: "size-8", xl: "size-12" };

export type SpinnerProps = Omit<ComponentProps<"span">, "children"> & {
  size?: keyof typeof sizes;
  /** Accessible status text; also rendered visibly when `showLabel`. */
  label?: string;
  showLabel?: boolean;
  tone?: "brand" | "current";
};

export function Spinner({ size = "sm", label, showLabel = false, tone = "brand", className, ...props }: SpinnerProps) {
  return (
    <span {...props} aria-live={label ? "polite" : undefined} className={cn("inline-flex items-center gap-2", className)} data-slot="spinner" role={label ? "status" : undefined}>
      <svg aria-hidden="true" className={cn("shrink-0 animate-spin motion-reduce:animate-none", sizes[size])} fill="none" viewBox="0 0 32 32">
        <circle className={tone === "brand" ? "stroke-bg-quaternary" : "stroke-current opacity-25"} cx="16" cy="16" r="13" strokeWidth="4" />
        <circle className={tone === "brand" ? "stroke-fg-brand-primary" : "stroke-current"} cx="16" cy="16" r="13" strokeDasharray="82" strokeDashoffset="60" strokeLinecap="round" strokeWidth="4" />
      </svg>
      {label ? <span className={showLabel ? "text-sm font-medium text-secondary" : "sr-only"}>{label}</span> : null}
    </span>
  );
}
