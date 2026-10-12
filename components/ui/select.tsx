"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"

import { AppIcon } from "@/components/ui/app-icon"
import { fieldSurface } from "@/components/ui/input"
import { TransitionSelectContent } from "@/components/ui/transition-surface"
import { cn } from "@/lib/utils"

/*
 * Select — Radix Select (keeps the combobox role, typeahead and existing value/onValueChange API)
 * dressed in the Untitled UI React select look (`components/base/select`, MIT).
 * Menu motion is the transitions.dev dropdown recipe (TransitionSelectContent).
 */

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectGroup(props: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return <SelectPrimitive.Label className={cn("px-2.5 pt-2 pb-1 text-xs font-medium text-quaternary", className)} data-slot="select-label" {...props} />
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border-secondary", className)} data-slot="select-separator" {...props} />
}

function SelectTrigger({
  className,
  children,
  size = "md",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { size?: "sm" | "md" | "lg" }) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        fieldSurface,
        "group flex cursor-pointer items-center justify-between gap-2 text-left",
        size === "sm" ? "h-8 px-2.5" : size === "lg" ? "h-10 px-3.5" : "h-9 px-3",
        "data-[state=open]:ring-2 data-[state=open]:ring-brand data-[placeholder]:text-placeholder",
        "[&>span]:min-w-0 [&>span]:truncate [&>span]:text-left",
        className,
      )}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <AppIcon name="chevronDown" className="size-4 shrink-0 text-fg-quaternary transition-transform duration-200 ease-out group-data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "popper",
  align = "start",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <TransitionSelectContent
        align={align}
        className={cn(
          "relative z-50 max-h-[min(20rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg bg-primary_alt text-primary shadow-lg ring-1 ring-secondary_alt data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className,
        )}
        data-slot="select-content"
        position={position}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">
          {children}
        </SelectPrimitive.Viewport>
      </TransitionSelectContent>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex min-h-9 w-full cursor-pointer items-center rounded-md py-2 pr-8 pl-2.5 text-left text-sm font-medium text-primary outline-none select-none",
        "transition-colors duration-100 data-[highlighted]:bg-primary_hover data-[state=checked]:bg-active",
        "data-[disabled]:cursor-not-allowed data-[disabled]:text-disabled",
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2.5 flex size-4 items-center justify-center text-fg-brand-primary">
        <SelectPrimitive.ItemIndicator>
          <AppIcon name="check" className="size-4" strokeWidth={2} />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue }
