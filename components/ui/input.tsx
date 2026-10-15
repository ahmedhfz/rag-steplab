import type { ComponentProps, ReactNode } from "react";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { cn } from "@/lib/utils";

/*
 * Input — field styling from Untitled UI React `components/base/input/input.tsx` (MIT) on a native
 * <input> (value/onChange/ref unchanged). The boundary uses `ring-control` (>= 3:1) and turns
 * brand on focus; invalid turns it error.
 */

export type InputSize = "sm" | "md" | "lg";

const sizes: Record<InputSize, { field: string; icon: string; padLeading: string; padTrailing: string }> = {
  sm: { field: "h-8 px-2.5", icon: "left-2.5 size-4", padLeading: "pl-8", padTrailing: "pr-8" },
  md: { field: "h-9 px-3", icon: "left-3 size-4", padLeading: "pl-9", padTrailing: "pr-9" },
  lg: { field: "h-10 px-3.5", icon: "left-3.5 size-5", padLeading: "pl-10.5", padTrailing: "pr-10" },
};

/** Shared surface for text-entry controls (Input, Textarea, Select trigger). */
export const fieldSurface = cn(
  // 16px on touch screens (iOS zooms into smaller fields on focus); 14px from sm with a mouse/trackpad.
  "w-full min-w-0 rounded-lg bg-primary text-md text-primary shadow-xs ring-1 ring-control ring-inset sm:not-pointer-coarse:text-sm",
  "transition-[box-shadow,background-color] duration-100 ease-out outline-none focus-visible:outline-none",
  "placeholder:text-placeholder hover:ring-control_hover",
  "focus:ring-2 focus:ring-brand",
  "disabled:cursor-not-allowed disabled:bg-secondary disabled:text-disabled disabled:shadow-none disabled:ring-secondary",
  "aria-invalid:ring-error_subtle aria-invalid:focus:ring-error",
  "file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-secondary",
);

export type InputProps = Omit<ComponentProps<"input">, "size"> & {
  size?: InputSize;
  /** Leading AppIcon. */
  icon?: SemanticIconName;
  /** Trailing adornment (unit, Kbd, button). */
  trailing?: ReactNode;
  /** Classes for the wrapper when `icon`/`trailing` is used. */
  wrapperClassName?: string;
};

export function Input({ size = "md", icon, trailing, className, wrapperClassName, type = "text", ...props }: InputProps) {
  const s = sizes[size];
  const input = (
    <input
      type={type}
      data-slot="input"
      {...props}
      className={cn(fieldSurface, s.field, icon && s.padLeading, trailing ? s.padTrailing : null, className)}
    />
  );
  if (!icon && !trailing) return input;
  return (
    <div className={cn("relative flex w-full min-w-0 items-center", wrapperClassName)} data-slot="input-group">
      {icon ? <AppIcon className={cn("pointer-events-none absolute text-fg-quaternary", s.icon)} name={icon} /> : null}
      {input}
      {trailing ? <span className="absolute right-2 flex items-center gap-1 text-sm text-tertiary">{trailing}</span> : null}
    </div>
  );
}
