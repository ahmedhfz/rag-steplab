import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type PageHeaderProps = Omit<ComponentProps<"header">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  /** Page-level actions, aligned to the title row. One primary action at most. */
  actions?: ReactNode;
  /** Usually a <HowItWorks> disclosure, rendered under the title block. */
  help?: ReactNode;
  /** Small context line above the title (breadcrumb, lineage chip). Only when it carries information. */
  context?: ReactNode;
};

/** The single page title pattern (Untitled "page header" type scale): display-xs title, md description, no fixed height. */
export function PageHeader({ title, description, actions, help, context, className, ...props }: PageHeaderProps) {
  return (
    <header {...props} className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0 max-w-3xl">
        {context ? <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-tertiary">{context}</div> : null}
        <h1 className="text-display-xs font-semibold text-primary">{title}</h1>
        {description ? <p className="mt-1 text-md text-tertiary">{description}</p> : null}
        {help ? <div className="mt-3">{help}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
