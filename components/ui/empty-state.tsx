import type { ComponentProps, ReactNode } from "react";

import type { SemanticIconName } from "@/components/ui/app-icon";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { cn } from "@/lib/utils";

/*
 * EmptyState — layout from Untitled UI React `components/application/empty-state/empty-state.tsx`
 * (MIT): featured icon over faint concentric rings, title, description, actions.
 * An empty surface is not an error: no warning colour, one primary action at most.
 */

function Rings() {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute top-1/2 left-1/2 size-60 -translate-1/2 text-border-secondary [mask-image:radial-gradient(closest-side,black,transparent)]" fill="none" viewBox="0 0 240 240">
      {[24, 48, 72, 96, 120].map((r) => <circle cx="120" cy="120" key={r} r={r - 0.5} stroke="currentColor" />)}
    </svg>
  );
}

export type EmptyStateProps = Omit<ComponentProps<"div">, "title"> & {
  icon?: SemanticIconName;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Heading element for the title; keep the page's heading order intact. */
  titleAs?: "h1" | "h2" | "h3" | "p";
  /** `md` for a page or panel body, `sm` for compact slots (cards, table bodies). */
  size?: "sm" | "md";
};

export function EmptyState({ icon, title, description, action, titleAs: Title = "h3", size = "md", className, ...props }: EmptyStateProps) {
  const compact = size === "sm";
  return (
    <div {...props} className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-8" : "px-6 py-12", className)} data-slot="empty-state">
      {icon ? (
        <div className={cn("relative grid place-items-center", compact ? "mb-3" : "mb-5")}>
          {compact ? null : <Rings />}
          <FeaturedIcon className="relative" icon={icon} size={compact ? "md" : "lg"} theme="modern" />
        </div>
      ) : null}
      <Title className={cn("relative font-semibold text-primary", compact ? "text-sm" : "text-md")}>{title}</Title>
      {description ? <p className={cn("relative mt-1 max-w-sm text-tertiary", compact ? "text-sm" : "text-sm")}>{description}</p> : null}
      {action ? <div className={cn("relative flex flex-wrap items-center justify-center gap-3", compact ? "mt-4" : "mt-6")}>{action}</div> : null}
    </div>
  );
}
