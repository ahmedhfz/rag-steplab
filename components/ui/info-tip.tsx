"use client";

import type { ComponentProps, ReactNode } from "react";

import { AppIcon } from "@/components/ui/app-icon";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type InfoTipProps = Omit<ComponentProps<"button">, "title" | "children"> & {
  /** Accessible name of the (?) button; pass localized copy. */
  label: string;
  /** Tooltip text; keep it to one or two short sentences. */
  title: ReactNode;
  description?: ReactNode;
};

/** A small (?) button that explains something in a tooltip instead of a visible helper line. */
export function InfoTip({ label, title, description, className, ...props }: InfoTipProps) {
  return (
    <Tooltip description={description} title={title}>
      <button
        {...props}
        aria-label={label}
        className={cn("grid size-5 shrink-0 cursor-help place-items-center rounded-md text-fg-quaternary hover:text-fg-quaternary_hover", className)}
        type="button"
      >
        <AppIcon className="size-4" name="help" />
      </button>
    </Tooltip>
  );
}
