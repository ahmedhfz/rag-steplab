import type { ComponentProps } from "react";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { cn } from "@/lib/utils";

/*
 * FeaturedIcon — Untitled UI React `components/foundations/featured-icon/featured-icon.tsx` (MIT),
 * reduced to three themes. Use for modal headers, empty states and feature callouts — not in rows.
 */

export type FeaturedIconColor = "gray" | "brand" | "success" | "warning" | "error";
export type FeaturedIconTheme = "light" | "modern" | "outline";
export type FeaturedIconSize = "sm" | "md" | "lg" | "xl";

const sizes: Record<FeaturedIconTheme, Record<FeaturedIconSize, string>> = {
  light: { sm: "size-8 [&_svg]:size-4", md: "size-10 [&_svg]:size-5", lg: "size-12 [&_svg]:size-6", xl: "size-14 [&_svg]:size-7" },
  modern: { sm: "size-8 rounded-md [&_svg]:size-4", md: "size-10 rounded-lg [&_svg]:size-5", lg: "size-12 rounded-xl [&_svg]:size-6", xl: "size-14 rounded-xl [&_svg]:size-7" },
  outline: { sm: "size-4 [&_svg]:size-4 before:size-6 after:size-8.5", md: "size-5 [&_svg]:size-5 before:size-7 after:size-9.5", lg: "size-6 [&_svg]:size-6 before:size-8 after:size-10.5", xl: "size-7 [&_svg]:size-7 before:size-9 after:size-11.5" },
};

const colors: Record<FeaturedIconTheme, Record<FeaturedIconColor, string>> = {
  light: {
    gray: "bg-tertiary text-featured-icon-light-fg-gray",
    brand: "bg-brand-secondary text-featured-icon-light-fg-brand",
    success: "bg-success-secondary text-featured-icon-light-fg-success",
    warning: "bg-warning-secondary text-featured-icon-light-fg-warning",
    error: "bg-error-secondary text-featured-icon-light-fg-error",
  },
  modern: {
    gray: "text-fg-secondary",
    brand: "text-fg-brand-primary",
    success: "text-fg-success-primary",
    warning: "text-fg-warning-primary",
    error: "text-fg-error-primary",
  },
  outline: {
    gray: "text-fg-tertiary before:border-fg-tertiary/30 after:border-fg-tertiary/10",
    brand: "text-fg-brand-primary before:border-fg-brand-primary/30 after:border-fg-brand-primary/10",
    success: "text-fg-success-primary before:border-fg-success-primary/30 after:border-fg-success-primary/10",
    warning: "text-fg-warning-primary before:border-fg-warning-primary/30 after:border-fg-warning-primary/10",
    error: "text-fg-error-primary before:border-fg-error-primary/30 after:border-fg-error-primary/10",
  },
};

const themes: Record<FeaturedIconTheme, string> = {
  light: "rounded-full",
  modern: "bg-primary shadow-xs-skeuomorphic ring-1 ring-primary ring-inset",
  outline: "before:absolute before:rounded-full before:border-2 after:absolute after:rounded-full after:border-2",
};

export type FeaturedIconProps = Omit<ComponentProps<"span">, "color"> & {
  icon: SemanticIconName;
  color?: FeaturedIconColor;
  theme?: FeaturedIconTheme;
  size?: FeaturedIconSize;
};

export function FeaturedIcon({ icon, color = "gray", theme = "modern", size = "md", className, ...props }: FeaturedIconProps) {
  return (
    <span
      aria-hidden="true"
      {...props}
      className={cn("relative inline-flex shrink-0 items-center justify-center", themes[theme], sizes[theme][size], colors[theme][color], className)}
      data-slot="featured-icon"
    >
      <AppIcon className="relative" name={icon} />
    </span>
  );
}
