"use client"

import * as React from "react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

import { AppIcon } from "@/components/ui/app-icon"
import { cn } from "@/lib/utils"

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
        "group relative grid size-10 shrink-0 place-items-center rounded-full border border-transparent bg-transparent text-brand outline-none transition-[border-color,box-shadow] before:absolute before:size-4 before:rounded-full before:border before:border-input before:bg-card before:content-[''] data-[state=checked]:before:border-brand disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      data-slot="radio-group-item"
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="relative z-10 grid place-items-center" data-slot="radio-group-indicator">
        <AppIcon name="circle" className="size-2" strokeWidth={4} />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
