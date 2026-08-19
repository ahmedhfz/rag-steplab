"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "group inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-slate-300 outline-none transition-[background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 data-[state=checked]:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-0.5 rounded-full bg-white shadow-xs transition-transform group-data-[state=checked]:translate-x-[18px]" data-slot="switch-thumb" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
