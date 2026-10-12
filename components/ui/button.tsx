"use client";

import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { Slot } from "radix-ui";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { cn } from "@/lib/utils";

/*
 * Button — styles ported from Untitled UI React `components/base/buttons/button.tsx` (MIT,
 * github.com/untitleduico/react), rebuilt on a native <button> so existing `onClick`,
 * `disabled`, `type`, `ref` and `asChild` call sites keep working. Adds the StepLab
 * pearl CTA and a tactile press.
 */

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "destructive" | "destructive-secondary" | "link" | "link-gray" | "pearl";
/** Pre-redesign names, still accepted: default → primary, outline → secondary, ghost → tertiary. */
export type LegacyButtonVariant = "default" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "lg" | "xl" | "icon-sm" | "icon" | "icon-lg";
/** Pre-redesign name: default → md. */
export type LegacyButtonSize = "default";

const legacyVariant: Record<LegacyButtonVariant, ButtonVariant> = { default: "primary", outline: "secondary", ghost: "tertiary" };

const base = [
  "group/button relative isolate inline-flex shrink-0 cursor-pointer items-center justify-center font-semibold whitespace-nowrap select-none",
  "transition-[background-color,color,box-shadow,translate,opacity] duration-150 ease-out",
  // Tactile press: the button sinks a pixel.
  "active:not-disabled:translate-y-px",
  "disabled:cursor-not-allowed aria-disabled:cursor-not-allowed aria-disabled:pointer-events-none",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:transition-colors",
].join(" ");

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 gap-1 rounded-lg px-3 text-sm [&_svg:not([class*='size-'])]:size-4",
  md: "h-9 gap-1.5 rounded-lg px-3.5 text-sm [&_svg:not([class*='size-'])]:size-4",
  lg: "h-10 gap-1.5 rounded-lg px-4 text-sm [&_svg:not([class*='size-'])]:size-5",
  xl: "h-12 gap-2 rounded-xl px-5 text-md [&_svg:not([class*='size-'])]:size-5",
  "icon-sm": "size-8 rounded-lg [&_svg:not([class*='size-'])]:size-4",
  icon: "size-9 rounded-lg [&_svg:not([class*='size-'])]:size-5",
  "icon-lg": "size-10 rounded-lg [&_svg:not([class*='size-'])]:size-5",
};

// Inner top highlight on solid fills (Untitled's skeuomorphic gradient border).
const sheen = "before:pointer-events-none before:absolute before:inset-px before:-z-10 before:rounded-[inherit] before:border before:border-white/12 before:mask-b-from-0%";
const solidDisabled = "disabled:bg-secondary disabled:text-disabled disabled:shadow-none disabled:ring-secondary disabled:before:hidden disabled:[&_svg]:text-fg-quaternary";

const variants: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-brand-solid text-white shadow-xs-skeuomorphic ring-1 ring-transparent ring-inset hover:bg-brand-solid_hover",
    "[&_svg]:text-white/70 hover:[&_svg]:text-white/90",
    sheen,
    solidDisabled,
  ),
  secondary: cn(
    "bg-primary text-secondary shadow-xs-skeuomorphic ring-1 ring-primary ring-inset hover:bg-primary_hover hover:text-secondary_hover",
    "[&_svg]:text-fg-quaternary hover:[&_svg]:text-fg-quaternary_hover",
    "disabled:bg-primary disabled:text-disabled disabled:shadow-xs disabled:ring-secondary",
  ),
  tertiary: cn(
    "text-tertiary hover:bg-primary_hover hover:text-tertiary_hover",
    "[&_svg]:text-fg-quaternary hover:[&_svg]:text-fg-quaternary_hover",
    "disabled:bg-transparent disabled:text-disabled",
  ),
  destructive: cn(
    "bg-error-solid text-white shadow-xs-skeuomorphic ring-1 ring-transparent ring-inset hover:bg-error-solid_hover",
    "[&_svg]:text-white/70 hover:[&_svg]:text-white/90",
    sheen,
    solidDisabled,
  ),
  "destructive-secondary": cn(
    "bg-primary text-error-primary shadow-xs-skeuomorphic ring-1 ring-error_subtle ring-inset hover:bg-error-primary hover:text-error-primary_hover",
    "[&_svg]:text-fg-error-secondary",
    "disabled:bg-primary disabled:text-disabled disabled:ring-secondary",
  ),
  link: cn(
    "h-auto! rounded-sm p-0! text-brand-secondary underline decoration-transparent underline-offset-4 hover:text-brand-secondary_hover hover:decoration-current",
    "disabled:text-disabled disabled:no-underline",
  ),
  "link-gray": cn(
    "h-auto! rounded-sm p-0! text-tertiary underline decoration-transparent underline-offset-4 hover:text-tertiary_hover hover:decoration-current",
    "disabled:text-disabled disabled:no-underline",
  ),
  // Visual recipe lives in globals.css (.steplab-pearl); pill shape always.
  // The icon tilt (globals.css) needs transform in the transition; the base list only animates colour.
  pearl: "steplab-pearl rounded-full! px-5 [&_svg]:text-current [&_svg]:transition-[color,transform] [&_svg]:duration-300",
};

export type ButtonStyleOptions = {
  variant?: ButtonVariant | LegacyButtonVariant;
  size?: ButtonSize | LegacyButtonSize;
  className?: string;
};

/** Class string for a button look on another element (e.g. a Next <Link>), when `asChild` is not convenient. */
export function buttonStyles({ variant = "primary", size = "md", className }: ButtonStyleOptions = {}) {
  const resolvedVariant = variant in legacyVariant ? legacyVariant[variant as LegacyButtonVariant] : (variant as ButtonVariant);
  const resolvedSize: ButtonSize = size === "default" ? "md" : size;
  const isLink = resolvedVariant === "link" || resolvedVariant === "link-gray";
  return cn(base, sizes[resolvedSize], variants[resolvedVariant], isLink && "gap-1", className);
}

type IconInput = SemanticIconName | ReactNode;

function renderIcon(icon: IconInput, slot: "leading" | "trailing") {
  if (icon === undefined || icon === null || icon === false) return null;
  if (typeof icon === "string") return <AppIcon data-icon={slot} name={icon as SemanticIconName} />;
  return isValidElement(icon) ? icon : null;
}

export type ButtonProps = Omit<ComponentProps<"button">, "color"> & ButtonStyleOptions & {
  /** Render the child element (e.g. Next <Link>) with button styles. Icons and loading are ignored. */
  asChild?: boolean;
  /** AppIcon name or element shown before the label. */
  iconLeading?: IconInput;
  /** AppIcon name or element shown after the label. */
  iconTrailing?: IconInput;
  /** Shows a spinner, keeps the width, sets aria-busy and blocks presses. */
  isLoading?: boolean;
};

export function Button({ variant, size = "md", asChild = false, iconLeading, iconTrailing, isLoading = false, className, children, disabled, onClick, ...props }: ButtonProps) {
  const classes = buttonStyles({ variant: variant ?? "primary", size, className });
  // data-variant keeps the name the caller used, so emphasis assertions read naturally.
  const data = { "data-slot": "button", "data-variant": variant ?? "default", "data-size": size };

  if (asChild) {
    return <Slot.Root {...data} className={classes} {...(props as ComponentProps<typeof Slot.Root>)}>{children}</Slot.Root>;
  }

  return (
    <button
      type="button"
      {...data}
      {...props}
      aria-busy={isLoading || props["aria-busy"] || undefined}
      className={cn(classes, isLoading && "pointer-events-none")}
      data-loading={isLoading || undefined}
      disabled={disabled}
      onClick={isLoading ? undefined : onClick}
    >
      {isLoading ? (
        <svg aria-hidden="true" className="absolute top-1/2 left-1/2 size-5 -translate-1/2 animate-spin motion-reduce:animate-none" data-icon="loading" fill="none" viewBox="0 0 20 20">
          <circle className="stroke-current opacity-30" cx="10" cy="10" fill="none" r="8" strokeWidth="2" />
          <circle className="origin-center stroke-current" cx="10" cy="10" fill="none" r="8" strokeDasharray="12.5 50" strokeLinecap="round" strokeWidth="2" />
        </svg>
      ) : null}
      {/* `contents` keeps children as flex items (gap applies). Transparent colour (not `invisible`) hides
          text and currentColor icons while the width holds, so the accessible name stays. */}
      <span className={cn("contents", isLoading && "text-transparent *:opacity-0")}>
        {renderIcon(iconLeading, "leading")}
        {children}
        {renderIcon(iconTrailing, "trailing")}
      </span>
    </button>
  );
}
