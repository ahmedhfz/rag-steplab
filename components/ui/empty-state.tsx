import type { ComponentProps, ReactNode } from "react";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { cn } from "@/lib/utils";

export type EmptyStateProps = Omit<ComponentProps<"div">, "title"> & {
  icon?: SemanticIconName;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Heading element for the title; keep the page's heading order intact. */
  titleAs?: "h2" | "h3" | "p";
};

/** Calm empty state: an empty surface is not an error, so no warning colour. */
export function EmptyState({ icon, title, description, action, titleAs: Title = "h3", className, ...props }: EmptyStateProps) {
  return (
    <div {...props} className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      {icon ? <span aria-hidden="true" className="grid size-10 place-items-center rounded-lg bg-secondary text-muted-foreground"><AppIcon name={icon} className="size-5" /></span> : null}
      <Title className={cn("text-base font-medium text-foreground", icon && "mt-3")}>{title}</Title>
      {description ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
