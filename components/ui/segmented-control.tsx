"use client";

import type { ReactNode } from "react";
import { RadioButton, RadioField, RadioGroup } from "react-aria-components";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { useSlidingIndicator } from "@/components/ui/use-sliding-indicator";
import { cn } from "@/lib/utils";

/*
 * SegmentedControl — the one control for "pick one of a few" (view mode, theme, strategy).
 * Radio semantics from React Aria (role="radiogroup", native radios: arrow keys move and select).
 * Look follows Untitled UI React button-group / tabs "button-border" (MIT); the selected pill
 * slides between options (useSlidingIndicator) on the transitions.dev tab timing.
 */

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: SemanticIconName;
  /** Show only the icon; `label` stays as the accessible name. */
  iconOnly?: boolean;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<SegmentedOption<T>>;
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  size?: "sm" | "md";
  /** Stretch to the container and split it evenly; segments stack below `sm`. */
  fullWidth?: boolean;
  isDisabled?: boolean;
  name?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

const sizes = {
  sm: { item: "h-7 gap-1.5 px-2.5 text-sm", icon: "size-4", iconOnly: "w-8 px-0" },
  md: { item: "h-8 gap-2 px-3 text-sm", icon: "size-4", iconOnly: "w-9 px-0" },
};

export function SegmentedControl<T extends string>({ options, value, defaultValue, onChange, size = "md", fullWidth = false, isDisabled, name, className, ...aria }: SegmentedControlProps<T>) {
  const s = sizes[size];
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement>("label[data-selected]");
  return (
    <RadioGroup
      {...aria}
      ref={containerRef}
      className={cn(
        "relative inline-flex max-w-full rounded-lg bg-tertiary p-0.5 ring-1 ring-secondary ring-inset dark:bg-secondary_alt",
        // Long labels (e.g. "Structure-aware", "Özyinelemeli") cannot share a phone row: stack them.
        fullWidth && "flex w-full max-sm:flex-col",
        isDisabled && "opacity-60",
        className,
      )}
      data-slot="segmented-control"
      defaultValue={defaultValue}
      isDisabled={isDisabled}
      name={name}
      onChange={(next) => onChange?.(next as T)}
      orientation="horizontal"
      value={value}
    >
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 rounded-md bg-primary opacity-0 shadow-sm ring-1 ring-secondary_alt transition-[translate,width,opacity] duration-(--tabs-dur) ease-(--tabs-ease) dark:bg-quaternary" ref={indicatorRef} />
      {options.map((option) => (
        <RadioField className={cn("relative flex", fullWidth && "min-w-0 flex-1")} isDisabled={option.disabled} key={option.value} value={option.value}>
          <RadioButton
            className={cn(
              "relative z-10 inline-flex w-full cursor-pointer items-center justify-center rounded-md font-semibold whitespace-nowrap text-tertiary outline-none select-none",
              "transition-colors duration-150 ease-out hover:text-secondary data-selected:text-primary",
              "data-focus-visible:outline-2 data-focus-visible:outline-offset-0 data-focus-visible:outline-focus-ring",
              "data-disabled:cursor-not-allowed data-disabled:text-disabled",
              s.item,
              option.iconOnly && s.iconOnly,
            )}
          >
            {option.icon ? <AppIcon className={cn(s.icon, "shrink-0")} name={option.icon} /> : null}
            {option.iconOnly ? <span className="sr-only">{option.label}</span> : option.label}
          </RadioButton>
        </RadioField>
      ))}
    </RadioGroup>
  );
}
