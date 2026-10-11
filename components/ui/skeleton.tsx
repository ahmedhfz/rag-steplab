import { cn } from "@/lib/utils";

/**
 * Loading placeholder built on the 14-skeleton-reveal recipe (`t-skel`);
 * `steplab-skeleton` keeps it in flow and pulsing (transition-adapters.css).
 */
export function Skeleton({ rows = 3, label, className, rowClassName }: { rows?: number; label?: string; className?: string; rowClassName?: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className={cn("t-skel steplab-skeleton", className)} data-testid="skeleton">
      <div aria-hidden="true" className="t-skel-skeleton is-pulsing grid gap-2">
        {Array.from({ length: rows }, (_, index) => <div className={cn("h-10 rounded-md bg-secondary", rowClassName)} key={index} />)}
      </div>
      {label ? <span className="sr-only">{label}</span> : null}
    </div>
  );
}
