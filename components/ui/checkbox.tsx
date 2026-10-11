"use client";

import type { ReactNode } from "react";
import { Checkbox as AriaCheckbox, type CheckboxProps as AriaCheckboxProps } from "react-aria-components";

import { cn } from "@/lib/utils";

/*
 * Checkbox — Untitled UI React `components/base/checkbox/checkbox.tsx` (MIT) on React Aria.
 * API: isSelected / defaultSelected / onChange(isSelected) / isIndeterminate / isDisabled.
 * The tick draws itself in (stroke-dashoffset) — reduced motion makes it instant.
 */

export type CheckboxBoxProps = {
  size?: "sm" | "md";
  isSelected?: boolean;
  isIndeterminate?: boolean;
  isDisabled?: boolean;
  isFocusVisible?: boolean;
  className?: string;
};

/** The visual box only (for custom rows that own their own semantics). */
export function CheckboxBox({ size = "sm", isSelected, isIndeterminate, isDisabled, isFocusVisible, className }: CheckboxBoxProps) {
  const on = isSelected || isIndeterminate;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 items-center justify-center bg-primary ring-1 ring-control ring-inset transition-[background-color,box-shadow] duration-150 ease-out",
        size === "md" ? "size-5 rounded-md" : "size-4 rounded",
        on && "bg-brand-solid ring-brand-solid",
        isDisabled && (on ? "bg-brand-solid/40 ring-transparent" : "bg-secondary ring-secondary"),
        isFocusVisible && "outline-2 outline-offset-2 outline-focus-ring",
        className,
      )}
      data-slot="checkbox-box"
    >
      <svg className={cn("pointer-events-none absolute text-white", size === "md" ? "size-3.5" : "size-3")} fill="none" viewBox="0 0 14 14">
        {isIndeterminate ? (
          <path d="M2.917 7h8.166" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        ) : (
          <path
            className="transition-[stroke-dashoffset] duration-200 ease-out"
            d="M11.667 3.5 5.25 9.917 2.333 7"
            stroke="currentColor"
            strokeDasharray="14"
            strokeDashoffset={isSelected ? 0 : 14}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        )}
      </svg>
    </span>
  );
}

export type CheckboxProps = Omit<AriaCheckboxProps, "children"> & {
  size?: "sm" | "md";
  label?: ReactNode;
  hint?: ReactNode;
};

export function Checkbox({ label, hint, size = "sm", className, ...props }: CheckboxProps) {
  return (
    <AriaCheckbox
      {...props}
      className={(state) =>
        cn(
          "group/checkbox relative flex w-fit cursor-pointer items-start outline-none data-focus-visible:outline-none",
          size === "md" ? "gap-3" : "gap-2",
          state.isDisabled && "cursor-not-allowed",
          typeof className === "function" ? className(state) : className,
        )
      }
      data-slot="checkbox"
    >
      {({ isSelected, isIndeterminate, isDisabled, isFocusVisible }) => (
        <>
          <CheckboxBox
            className={label || hint ? (size === "md" ? "mt-0.5" : "mt-0.5") : undefined}
            isDisabled={isDisabled}
            isFocusVisible={isFocusVisible}
            isIndeterminate={isIndeterminate}
            isSelected={isSelected}
            size={size}
          />
          {label || hint ? (
            <span className="flex flex-col">
              {label ? <span className={cn("font-medium text-secondary select-none", size === "md" ? "text-md" : "text-sm", isDisabled && "text-disabled")}>{label}</span> : null}
              {hint ? <span className={cn("text-tertiary", size === "md" ? "text-md" : "text-sm")}>{hint}</span> : null}
            </span>
          ) : null}
        </>
      )}
    </AriaCheckbox>
  );
}
