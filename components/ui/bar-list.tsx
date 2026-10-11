"use client";

import { useMemo, type ComponentProps, type ReactNode } from "react";
import { useLocale } from "react-aria-components";

import { chartColors, type ChartColor } from "@/components/ui/chart-colors";
import { cn } from "@/lib/utils";

/*
 * BarList — derived from Tremor Raw BarList v1.0.0 (Apache-2.0, github.com/tremorlabs/tremor,
 * src/components/BarList). Modified: StepLab tokens, per-row colour/highlight, tabular values,
 * native buttons for interactive rows, grow-in animation tied to the motion system.
 * Use for ranked magnitudes: retrieval scores per chunk, tokens per section, pages per document.
 */

export type BarListItem = {
  key?: string;
  name: ReactNode;
  value: number;
  /** Colour override for this row (e.g. brand for the selected chunk). */
  color?: ChartColor;
  /** Optional muted text after the name (page, id). */
  meta?: ReactNode;
};

export type BarListProps<T extends BarListItem> = Omit<ComponentProps<"div">, "onSelect"> & {
  data: ReadonlyArray<T>;
  valueFormatter?: (value: number) => ReactNode;
  color?: ChartColor;
  sortOrder?: "ascending" | "descending" | "none";
  /** Makes rows buttons. */
  onValueChange?: (item: T) => void;
  /** Accessible name for the list. */
  "aria-label"?: string;
};

export function BarList<T extends BarListItem>({ data, valueFormatter, color = "gray", sortOrder = "descending", onValueChange, className, ...props }: BarListProps<T>) {
  const sorted = useMemo(() => (sortOrder === "none" ? [...data] : [...data].sort((a, b) => (sortOrder === "ascending" ? a.value - b.value : b.value - a.value))), [data, sortOrder]);
  const max = Math.max(...sorted.map((item) => item.value), 0);
  const Row = onValueChange ? "button" : "div";
  const { locale } = useLocale();
  const format = valueFormatter ?? ((value: number) => new Intl.NumberFormat(locale).format(value));

  return (
    <div {...props} className={cn("flex flex-col gap-1.5", className)} data-slot="bar-list" role="list">
      {sorted.map((item, index) => {
        const width = item.value === 0 || max === 0 ? 0 : Math.max((item.value / max) * 100, 2);
        const palette = chartColors[item.color ?? color];
        return (
          <div className="flex items-center gap-4" key={item.key ?? String(index)} role="listitem">
            <Row
              className={cn("group relative h-8 min-w-0 flex-1 rounded-md text-left", onValueChange && "cursor-pointer outline-none hover:bg-primary_hover focus-visible:outline-2 focus-visible:outline-focus-ring")}
              onClick={onValueChange ? () => onValueChange(item) : undefined}
              type={onValueChange ? "button" : undefined}
            >
              <span
                aria-hidden="true"
                className={cn("absolute inset-y-0 left-0 origin-left animate-in rounded-md fade-in slide-in-from-left-2 duration-500 ease-out transition-[width] fill-mode-backwards", palette.tint, onValueChange && palette.tintHover)}
                style={{ width: `${width}%`, animationDelay: `${Math.min(index, 8) * 40}ms` }}
              />
              <span className="relative flex h-full min-w-0 items-center gap-2 px-2.5 text-sm">
                <span className="truncate font-medium text-primary">{item.name}</span>
                {item.meta ? <span className="shrink-0 text-xs text-quaternary">{item.meta}</span> : null}
              </span>
            </Row>
            <span className="shrink-0 text-right text-sm font-medium text-secondary tabular-nums">{format(item.value)}</span>
          </div>
        );
      })}
    </div>
  );
}
