"use client";

import type { ReactNode } from "react";
import { Label, Slider as AriaSlider, SliderOutput, SliderThumb, SliderTrack, type SliderProps as AriaSliderProps } from "react-aria-components";

import { cn } from "@/lib/utils";

/*
 * Slider — Untitled UI React `components/base/slider/slider.tsx` (MIT) on React Aria
 * (arrow keys, Page Up/Down, Home/End, touch). Thumb is tactile: it grows while dragged.
 * Values are plain numbers by default; pass formatOptions for units/percent.
 */

export type SliderProps = Omit<AriaSliderProps<number | number[]>, "children"> & {
  label?: ReactNode;
  /** Show the formatted value next to the label. */
  showValue?: boolean;
  className?: string;
};

export function Slider({ label, showValue = true, minValue = 0, maxValue = 100, className, formatOptions, ...props }: SliderProps) {
  return (
    <AriaSlider {...props} className={cn("flex w-full flex-col gap-2", className)} formatOptions={formatOptions} maxValue={maxValue} minValue={minValue}>
      {label || showValue ? (
        <div className="flex items-center justify-between gap-3">
          {label ? <Label className="text-sm font-medium text-secondary">{label}</Label> : <span />}
          {showValue ? <SliderOutput className="text-sm font-medium text-tertiary tabular-nums" /> : null}
        </div>
      ) : null}
      <SliderTrack className="relative h-6 w-full cursor-pointer data-disabled:cursor-not-allowed">
        {({ state }) => {
          const single = state.values.length === 1;
          const start = single ? 0 : state.getThumbPercent(0);
          const end = single ? state.getThumbPercent(0) : state.getThumbPercent(1);
          return (
            <>
              <span className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-quaternary" />
              <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand-solid in-data-disabled:bg-fg-quaternary" style={{ left: `${start * 100}%`, width: `${(end - start) * 100}%` }} />
              {state.values.map((_, index) => (
                <SliderThumb
                  className={({ isDragging, isFocusVisible }) =>
                    cn(
                      "top-1/2 size-5 cursor-grab rounded-full bg-slider-handle-bg shadow-md ring-2 ring-slider-handle-border ring-inset transition-[scale,box-shadow] duration-150 ease-out",
                      "hover:scale-110 data-disabled:cursor-not-allowed data-disabled:ring-fg-quaternary",
                      isDragging && "scale-115 cursor-grabbing shadow-lg",
                      isFocusVisible && "outline-2 outline-offset-2 outline-focus-ring",
                    )
                  }
                  index={index}
                  key={index}
                />
              ))}
            </>
          );
        }}
      </SliderTrack>
    </AriaSlider>
  );
}
