"use client";

import { useMemo, type ComponentProps, type ReactNode } from "react";
import { useLocale } from "react-aria-components";

import { chartColors, type ChartColor } from "@/components/ui/chart-colors";
import { cn } from "@/lib/utils";

/*
 * CategoryBar — derived from Tremor Raw CategoryBar v0.0.3 (Apache-2.0, github.com/tremorlabs/tremor,
 * src/components/CategoryBar). Modified: StepLab semantic colours, optional legend instead of
 * cumulative tick labels, marker with an accessible label, no external tooltip dependency.
 * Use for a whole split into parts: context budget (system / retrieved / question / free),
 * pass / warn / fail counts.
 */

export type CategoryBarSegment = { label: ReactNode; value: number; color: ChartColor };

export type CategoryBarProps = Omit<ComponentProps<"div">, "children"> & {
  segments: ReadonlyArray<CategoryBarSegment>;
  /** A position marker on the same scale (e.g. a threshold or the current value). */
  marker?: { value: number; label: string };
  showLegend?: boolean;
  valueFormatter?: (value: number) => ReactNode;
  /** Accessible summary, e.g. "Context budget: 3,120 of 4,096 tokens". */
  "aria-label": string;
};

export function CategoryBar({ segments, marker, showLegend = true, valueFormatter, className, ...props }: CategoryBarProps) {
  const total = useMemo(() => segments.reduce((sum, segment) => sum + Math.max(segment.value, 0), 0), [segments]);
  const { locale } = useLocale();
  const format = valueFormatter ?? ((value: number) => new Intl.NumberFormat(locale).format(value));
  const markerLeft = marker && total > 0 ? Math.min(100, Math.max(0, (marker.value / total) * 100)) : null;
  return (
    <div {...props} className={cn("flex w-full flex-col gap-3", className)} data-slot="category-bar" role="figure">
      <div className="relative">
        <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
          {segments.map((segment, index) => {
            const percent = total > 0 ? (Math.max(segment.value, 0) / total) * 100 : 0;
            return percent > 0 ? <div className={cn("h-full transition-[width] duration-500 ease-out first:rounded-l-full last:rounded-r-full", chartColors[segment.color].solid)} key={index} style={{ width: `${percent}%` }} /> : null;
          })}
        </div>
        {markerLeft !== null && marker ? (
          <div aria-label={marker.label} className="absolute top-1/2 -translate-1/2 transition-[left] duration-300 ease-out" role="img" style={{ left: `${markerLeft}%` }} title={marker.label}>
            <div className="h-4 w-1 rounded-full bg-fg-primary ring-2 ring-bg-primary" />
          </div>
        ) : null}
      </div>
      {showLegend ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          {segments.map((segment, index) => (
            <li className="inline-flex items-center gap-1.5 text-tertiary" key={index}>
              <span aria-hidden="true" className={cn("size-2 rounded-full", chartColors[segment.color].solid)} />
              {segment.label}
              <span className="font-medium text-secondary tabular-nums">{format(segment.value)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
