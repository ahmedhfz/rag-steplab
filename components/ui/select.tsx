"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"

import { TransitionSelectContent } from "@/components/ui/transition-surface"

import { AppIcon } from "@/components/ui/app-icon"
import { cn } from "@/lib/utils"

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "group flex h-9 w-full items-center justify-between gap-3 rounded-md border border-input bg-card px-3 text-left text-sm text-foreground outline-none transition-[border-color,background-color] hover:border-hover-border data-[state=open]:border-hover-border data-[placeholder]:text-subtle-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-subtle-foreground [&>span]:min-w-0 [&>span]:truncate [&>span]:text-left",
        className,
      )}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <AppIcon name="chevronDown" className="size-4 shrink-0 text-subtle-foreground transition-transform duration-150 group-data-[state=open]:rotate-180" />
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
          "relative z-50 max-h-[min(280px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg shadow-overlay/8 dark:shadow-overlay/40 data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
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
        "relative flex min-h-9 w-full cursor-default select-none items-center rounded-md py-2 pl-2.5 pr-8 text-left text-sm outline-none data-[highlighted]:bg-secondary data-[highlighted]:shadow-[inset_2px_0_0_var(--ring)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <AppIcon name="check" className="size-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue }

