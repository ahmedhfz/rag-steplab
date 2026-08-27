"use client"

import * as React from "react"
import { Circle } from "lucide-react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"

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
        "group relative grid size-10 shrink-0 place-items-center rounded-full border border-transparent bg-transparent text-[#711f3a] outline-none transition-[border-color,box-shadow] before:absolute before:size-4 before:rounded-full before:border before:border-[#bcb5b9] before:bg-white before:content-[''] focus-visible:ring-2 focus-visible:ring-[#711f3a]/15 data-[state=checked]:before:border-[#711f3a] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      data-slot="radio-group-item"
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="relative z-10 grid place-items-center" data-slot="radio-group-indicator">
        <Circle aria-hidden="true" className="size-2 fill-current stroke-none" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem }
