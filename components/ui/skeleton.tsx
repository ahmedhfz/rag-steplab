import { cn } from "@/lib/utils";

/**
 * Loading placeholder built on the 14-skeleton-reveal recipe (`t-skel`);
 * `steplab-skeleton` keeps it in flow and pulsing (transition-adapters.css).
 * Use it for lists/tables whose shape is known; use Spinner for short waits.
 */
export function Skeleton({ rows = 3, label, className, rowClassName }: { rows?: number; label?: string; className?: string; rowClassName?: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className={cn("t-skel steplab-skeleton", className)} data-testid="skeleton">
      <div aria-hidden="true" className="t-skel-skeleton is-pulsing grid gap-2">
        {Array.from({ length: rows }, (_, index) => <div className={cn("h-10 rounded-lg bg-tertiary", rowClassName)} key={index} />)}
      </div>
      {label ? <span className="sr-only">{label}</span> : null}
    </div>
  );
}

/** A single shimmer line/block for bespoke layouts (text lines, avatars, metric values). */
export function SkeletonBlock({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block h-4 animate-pulse rounded-md bg-tertiary motion-reduce:animate-none", className)} />;
}
