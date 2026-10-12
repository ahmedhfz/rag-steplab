"use client";

import type { ReactElement, ReactNode } from "react";
import { Focusable, OverlayArrow, Tooltip as AriaTooltip, TooltipTrigger as AriaTooltipTrigger, type TooltipProps as AriaTooltipProps } from "react-aria-components";

import { cn } from "@/lib/utils";

/*
 * Tooltip — Untitled UI React `components/base/tooltip/tooltip.tsx` (MIT) on React Aria.
 * Shows on hover *and* keyboard focus, hides on Escape. Short text only; for rich previews
 * use PreviewCard. The trigger must be one focusable element that spreads props + ref
 * (Button, a native <button>/<a>, Kbd-less icons wrapped in a button).
 */

export type TooltipProps = Omit<AriaTooltipProps, "children"> & {
  /** The trigger element. */
  children: ReactElement;
  title: ReactNode;
  description?: ReactNode;
  /** Keyboard hint rendered at the end, e.g. "⌘K". */
  shortcut?: string;
  arrow?: boolean;
  delay?: number;
  closeDelay?: number;
  isDisabled?: boolean;
};

export function Tooltip({ children, title, description, shortcut, arrow = false, delay = 300, closeDelay = 0, isDisabled, placement = "top", offset = 6, className, ...props }: TooltipProps) {
  return (
    <AriaTooltipTrigger closeDelay={closeDelay} delay={delay} isDisabled={isDisabled}>
      <Focusable>{children as ReactElement<Record<string, unknown>, string>}</Focusable>
      <AriaTooltip
        {...props}
        className={(state) =>
          cn(
            "z-50 max-w-xs origin-(--trigger-anchor-point) rounded-lg bg-primary-solid px-3 shadow-lg will-change-transform dark:ring-1 dark:ring-secondary_alt",
            description ? "py-3" : "py-2",
            state.isEntering && "animate-in duration-150 ease-out fade-in zoom-in-95 data-[placement=bottom]:slide-in-from-top-0.5 data-[placement=left]:slide-in-from-right-0.5 data-[placement=right]:slide-in-from-left-0.5 data-[placement=top]:slide-in-from-bottom-0.5",
            state.isExiting && "animate-out duration-100 ease-in fade-out zoom-out-95",
            typeof className === "function" ? className(state) : className,
          )
        }
        offset={offset}
        placement={placement}
      >
        {arrow ? (
          <OverlayArrow>
            <svg className="size-2.5 fill-bg-primary-solid in-data-[placement=bottom]:rotate-180 in-data-[placement=left]:-rotate-90 in-data-[placement=right]:rotate-90" viewBox="0 0 100 100">
              <path d="M0,0 L35.858,35.858 Q50,50 64.142,35.858 L100,0 Z" />
            </svg>
          </OverlayArrow>
        ) : null}
        <span className="flex items-center gap-2 text-xs font-semibold text-white">
          {title}
          {shortcut ? <kbd className="rounded-sm bg-white/10 px-1 font-sans text-xs font-medium text-tooltip-supporting-text ring-1 ring-white/15 ring-inset">{shortcut}</kbd> : null}
        </span>
        {description ? <span className="mt-1 block text-xs font-medium text-tooltip-supporting-text">{description}</span> : null}
      </AriaTooltip>
    </AriaTooltipTrigger>
  );
}
