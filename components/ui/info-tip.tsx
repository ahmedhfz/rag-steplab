"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { AppIcon } from "@/components/ui/app-icon";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type InfoTipProps = Omit<ComponentProps<"button">, "title" | "children" | "ref"> & {
  /** Accessible name of the (?) button; pass localized copy. */
  label: string;
  /** Tooltip text; keep it to one or two short sentences. */
  title: ReactNode;
  description?: ReactNode;
};

/**
 * A small (?) button that explains something in a tooltip instead of a visible helper line.
 * Hover and keyboard focus open it like any Tooltip. Touch has neither, so a tap toggles it;
 * an outside tap, Escape or a second tap closes it. The ::before layer grows the hit area to
 * 24px tall without changing the 20px box; it stays inside the box horizontally so it never adds
 * horizontal overflow (the 20px width meets WCAG 2.5.8 through its spacing exception).
 */
export function InfoTip({ label, title, description, className, onClick, onPointerDown, ...props }: InfoTipProps) {
  const [isOpen, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Open state at a touch/pen pointerdown: TooltipTrigger closes on press before the click arrives.
  const tapStartedOpen = useRef<boolean | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // Tooltips have no outside-press dismissal, and iOS Safari never focuses a tapped button, so no blur either.
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress, true);
  }, [isOpen]);

  return (
    <Tooltip description={description} isOpen={isOpen} onOpenChange={setOpen} title={title}>
      <button
        {...props}
        aria-label={label}
        className={cn("relative grid size-5 shrink-0 cursor-help place-items-center rounded-md text-fg-quaternary before:absolute before:inset-x-0 before:-inset-y-0.5 hover:text-fg-quaternary_hover", className)}
        onClick={(event) => {
          onClick?.(event);
          if (tapStartedOpen.current !== null) setOpen(!tapStartedOpen.current);
          tapStartedOpen.current = null;
        }}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          // Mouse keeps the hover behavior (a click closes); keyboard clicks have no pointerdown.
          tapStartedOpen.current = event.pointerType === "mouse" ? null : isOpen;
        }}
        ref={triggerRef}
        type="button"
      >
        <AppIcon className="size-4" name="help" />
      </button>
    </Tooltip>
  );
}
