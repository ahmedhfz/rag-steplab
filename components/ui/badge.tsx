import type { ComponentProps, ReactNode } from "react";
import { Slot } from "radix-ui";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { cn } from "@/lib/utils";

/*
 * Badge — ported from Untitled UI React `components/base/badges/badges.tsx` (MIT).
 * Colours are limited to StepLab's five families; use StatusBadge for run/step status.
 */

export type BadgeColor = "gray" | "brand" | "success" | "warning" | "error";
/** `pill`: fully rounded. `color`: rounded rectangle. `modern`: neutral chip with a shadow (colour tints only the dot/icon). */
export type BadgeType = "pill" | "color" | "modern";
export type BadgeSize = "sm" | "md" | "lg";

const filled: Record<BadgeColor, { root: string; addon: string }> = {
  gray: { root: "bg-utility-gray-50 text-utility-gray-700 ring-utility-gray-200", addon: "text-utility-gray-500" },
  brand: { root: "bg-utility-brand-50 text-utility-brand-700 ring-utility-brand-200", addon: "text-utility-brand-500" },
  success: { root: "bg-utility-success-50 text-utility-success-700 ring-utility-success-200", addon: "text-utility-success-500" },
  warning: { root: "bg-utility-warning-50 text-utility-warning-700 ring-utility-warning-200", addon: "text-utility-warning-500" },
  error: { root: "bg-utility-error-50 text-utility-error-700 ring-utility-error-200", addon: "text-utility-error-500" },
};

const shapes: Record<BadgeType, string> = {
  pill: "rounded-full",
  color: "rounded-md",
  modern: "rounded-md bg-primary text-secondary shadow-xs ring-primary",
};

const sizes: Record<BadgeSize, string> = {
  sm: "h-5.5 gap-1 px-2 text-xs [&_svg]:size-3",
  md: "h-6 gap-1 px-2.5 text-sm [&_svg]:size-3.5",
  lg: "h-7 gap-1.5 px-3 text-sm [&_svg]:size-4",
};

export type BadgeProps = Omit<ComponentProps<"span">, "color"> & {
  color?: BadgeColor;
  type?: BadgeType;
  size?: BadgeSize;
  /** Leading status dot in the badge colour. */
  dot?: boolean;
  /** Leading AppIcon. */
  icon?: SemanticIconName;
  /** Trailing content, e.g. a count. */
  trailing?: ReactNode;
  asChild?: boolean;
};

export function Badge({ color = "gray", type = "pill", size = "sm", dot = false, icon, trailing, asChild = false, className, children, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : "span";
  const palette = filled[color];
  return (
    <Comp
      data-slot="badge"
      data-color={color}
      {...props}
      className={cn(
        "inline-flex w-fit shrink-0 items-center font-medium whitespace-nowrap tabular-nums ring-1 ring-inset",
        type === "modern" ? shapes.modern : cn(shapes[type], palette.root),
        sizes[size],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full bg-current", palette.addon)} /> : null}
      {icon ? <AppIcon className={palette.addon} name={icon} strokeWidth={2} /> : null}
      {children}
      {trailing}
    </Comp>
  );
}
