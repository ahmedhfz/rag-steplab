"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  checked,
  defaultChecked,
  onCheckedChange,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  const [value, setValue] = React.useState(defaultChecked ?? false)
  const [interacted, setInteracted] = React.useState(false)
  const on = checked ?? value
  return (
    <SwitchPrimitive.Root
      className={cn(
        "group relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-transparent outline-none transition-[background-color,box-shadow] before:absolute before:inset-x-0 before:top-1/2 before:h-6 before:w-10 before:-translate-y-1/2 before:rounded-full before:bg-input before:content-[''] data-[state=checked]:before:bg-brand disabled:cursor-not-allowed disabled:opacity-50",
        "t-toggle steplab-switch",
        interacted && "is-init",
        className,
      )}
      data-slot="switch"
      data-on={String(on)}
      checked={on}
      onCheckedChange={(next) => { setInteracted(true); setValue(next); onCheckedChange?.(next) }}
      {...props}
    >
      <SwitchPrimitive.Thumb className="t-toggle-thumb pointer-events-none absolute left-0.5 top-[calc(50%_-_10px)] z-10 block size-5 rounded-full bg-card shadow-sm" data-slot="switch-thumb" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
