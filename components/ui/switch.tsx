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
        "group relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-transparent bg-transparent outline-none transition-[background-color,box-shadow] before:absolute before:inset-x-0 before:top-1/2 before:h-6 before:w-10 before:-translate-y-1/2 before:rounded-full before:bg-[#d8d2d5] before:content-[''] focus-visible:ring-2 focus-visible:ring-[#711f3a]/25 focus-visible:ring-offset-2 data-[state=checked]:before:bg-[#711f3a] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb className="relative z-10 pointer-events-none block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform group-data-[state=checked]:translate-x-[18px]" data-slot="switch-thumb" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
