import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * Surfaces. One rule: at most ONE framed surface between the canvas and the content.
 *  - Panel: the framed surface (bg-primary + hairline ring). Never nest a Panel in a Panel.
 *  - Section: frameless grouping (heading + content) used inside a Panel or on the canvas.
 *  - SectionLabel: the single overline style; at most one or two per screen.
 * Separate regions inside a Panel with Section spacing or <Separator/>, not with more boxes.
 */

export type PanelProps = Omit<ComponentProps<"section">, "ref"> & {
  /** `none` for edge-to-edge content (tables, lists); default is comfortable padding. */
  padding?: "none" | "sm" | "md" | "lg";
  /** Inset well (bg-secondary, no ring) for code, previews and technical readouts. */
  tone?: "default" | "inset";
  as?: "section" | "div" | "article" | "aside";
};

const paddings = { none: "", sm: "p-4", md: "p-5", lg: "p-6" };

export function Panel({ padding = "md", tone = "default", as: Tag = "section", className, ...props }: PanelProps) {
  return (
    <Tag
      {...props}
      className={cn(
        "min-w-0 rounded-xl",
        tone === "default" ? "bg-primary shadow-xs ring-1 ring-secondary" : "bg-secondary",
        paddings[padding],
        className,
      )}
      data-slot="panel"
    />
  );
}

export type PanelHeaderProps = Omit<ComponentProps<"header">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned actions (buttons, segmented control, meta). */
  actions?: ReactNode;
  /** Heading level for the title; keep the page outline intact. */
  titleAs?: "h2" | "h3" | "h4";
  /** Draw a hairline under the header (for edge-to-edge bodies such as tables). */
  divider?: boolean;
};

export function PanelHeader({ title, description, actions, titleAs: Title = "h2", divider = false, className, ...props }: PanelHeaderProps) {
  return (
    <header {...props} className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", divider && "border-b border-secondary pb-4", className)} data-slot="panel-header">
      <div className="min-w-0">
        <Title className="text-md font-semibold text-primary">{title}</Title>
        {description ? <p className="mt-0.5 text-sm text-tertiary">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export type SectionProps = Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Optional overline above the title (use sparingly). */
  label?: ReactNode;
  titleAs?: "h2" | "h3" | "h4";
};

export function Section({ title, description, actions, label, titleAs: Title = "h3", className, children, ...props }: SectionProps) {
  const hasHeader = Boolean(title || description || actions || label);
  return (
    <section {...props} className={cn("min-w-0", className)} data-slot="section">
      {hasHeader ? (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {label ? <SectionLabel className="mb-1">{label}</SectionLabel> : null}
            {title ? <Title className="text-sm font-semibold text-primary">{title}</Title> : null}
            {description ? <p className="mt-0.5 text-sm text-tertiary">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** The one overline style: 12px, semibold, quaternary, light tracking. */
export function SectionLabel({ className, ...props }: ComponentProps<"p">) {
  return <p {...props} className={cn("text-xs font-semibold tracking-wide text-quaternary uppercase", className)} data-slot="section-label" />;
}
