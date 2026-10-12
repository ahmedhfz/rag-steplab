"use client";

import type { ComponentProps } from "react";
import { HoverCard } from "radix-ui";

import { TransitionHoverCardContent } from "@/components/ui/transition-surface";
import { cn } from "@/lib/utils";

/*
 * PreviewCard — a rich hover/focus preview (citation [S1] → source passage, chunk id → chunk text).
 * Radix HoverCard (already a dependency; same role as Base UI's PreviewCard) with the Untitled
 * popover surface and the transitions.dev dropdown recipe. Opens on hover and keyboard focus of
 * the trigger; content must not be the only way to reach information (link the full source too).
 */

export function PreviewCard({ openDelay = 250, closeDelay = 120, ...props }: ComponentProps<typeof HoverCard.Root>) {
  return <HoverCard.Root closeDelay={closeDelay} openDelay={openDelay} {...props} />;
}

export const PreviewCardTrigger = HoverCard.Trigger;

export function PreviewCardContent({ className, sideOffset = 8, align = "start", ...props }: ComponentProps<typeof HoverCard.Content>) {
  return (
    <HoverCard.Portal>
      <TransitionHoverCardContent
        align={align}
        className={cn("z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl bg-primary_alt p-4 text-sm text-secondary shadow-lg ring-1 ring-secondary_alt outline-none", className)}
        collisionPadding={16}
        data-slot="preview-card"
        sideOffset={sideOffset}
        {...props}
      />
    </HoverCard.Portal>
  );
}
