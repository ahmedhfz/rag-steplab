import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type PageHeaderProps = Omit<ComponentProps<"header">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  /** Page-level actions, aligned to the title row. */
  actions?: ReactNode;
  /** Usually a <HowItWorks> disclosure, rendered under the title block. */
  help?: ReactNode;
};

/** The single page title pattern: no eyebrow, no fixed height. */
export function PageHeader({ title, description, actions, help, className, ...props }: PageHeaderProps) {
  return (
    <header {...props} className={cn("flex flex-wrap items-start justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        {help ? <div className="mt-2">{help}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
