"use client"

import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/*
 * RadioGroup — Radix RadioGroup (roving focus, arrow-key selection; API unchanged) with the
 * Untitled UI React radio look (`components/base/radio-buttons`, MIT): 16px circle, brand fill,
 * white centre dot. The button keeps a 40px hit area around the visible circle.
 * For a row of mutually exclusive options shown as a control, use SegmentedControl.
 */

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      className={cn("grid gap-2", className)}
      data-slot="radio-group"
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        "group/radio relative grid size-10 shrink-0 cursor-pointer place-items-center rounded-full outline-none disabled:cursor-not-allowed",
        className,
      )}
      data-slot="radio-group-item"
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-4 place-items-center rounded-full bg-primary ring-1 ring-control ring-inset transition-[background-color,box-shadow] duration-150 ease-out",
          "group-hover/radio:ring-control_hover group-data-[state=checked]/radio:bg-brand-solid group-data-[state=checked]/radio:ring-brand-solid",
          "group-focus-visible/radio:outline-2 group-focus-visible/radio:outline-offset-2 group-focus-visible/radio:outline-focus-ring",
          "group-disabled/radio:bg-secondary group-disabled/radio:ring-secondary group-disabled/radio:group-data-[state=checked]/radio:bg-brand-solid/40",
        )}
      >
        <RadioGroupPrimitive.Indicator className="size-1.5 rounded-full bg-white animate-in zoom-in-50 duration-150" data-slot="radio-group-indicator" />
      </span>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
