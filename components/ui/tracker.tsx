"use client";

import { useState, type ComponentProps } from "react";
import { HoverCard } from "radix-ui";

import { chartColors, type ChartColor } from "@/components/ui/chart-colors";
import { TransitionHoverCardContent } from "@/components/ui/transition-surface";
import { cn } from "@/lib/utils";

/*
 * Tracker — derived from Tremor Raw Tracker v1.0.0 (Apache-2.0, github.com/tremorlabs/tremor,
 * src/components/Tracker). Modified: semantic colours, list semantics with per-block labels,
 * StepLab tooltip surface and dropdown motion recipe.
 * Use for a run history strip: one block per run/case, coloured by outcome.
 */

export type TrackerBlock = { key?: string | number; color?: ChartColor; tooltip: string };

function Block({ color, tooltip, hoverEffect }: TrackerBlock & { hoverEffect: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <HoverCard.Root closeDelay={0} onOpenChange={setOpen} open={open} openDelay={0}>
      <HoverCard.Trigger asChild onClick={() => setOpen(true)}>
        <div aria-label={tooltip} className="h-full flex-1 px-px first:pl-0 last:pr-0" role="listitem">
          <div className={cn("size-full rounded-xs transition-opacity duration-150", color ? chartColors[color].solid : "bg-quaternary", hoverEffect && "hover:opacity-60")} />
        </div>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <TransitionHoverCardContent align="center" avoidCollisions className="z-50 rounded-lg bg-primary-solid px-2.5 py-1.5 text-xs font-medium text-white shadow-lg dark:ring-1 dark:ring-secondary_alt" data-origin="bottom-center" side="top" sideOffset={8}>
          {tooltip}
        </TransitionHoverCardContent>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

export type TrackerProps = Omit<ComponentProps<"div">, "children"> & {
  data: ReadonlyArray<TrackerBlock>;
  hoverEffect?: boolean;
  "aria-label": string;
};

export function Tracker({ data, hoverEffect = true, className, ...props }: TrackerProps) {
  return (
    <div {...props} className={cn("flex h-8 w-full items-center overflow-hidden rounded-md", className)} data-slot="tracker" role="list">
      {data.map(({ key, ...block }, index) => <Block hoverEffect={hoverEffect} key={key ?? index} {...block} />)}
    </div>
  );
}
