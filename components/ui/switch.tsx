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
        "group inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-transparent bg-[#d8d2d5] outline-none transition-[background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-[#711f3a]/25 focus-visible:ring-offset-2 data-[state=checked]:bg-[#711f3a] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform group-data-[state=checked]:translate-x-[18px]" data-slot="switch-thumb" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
