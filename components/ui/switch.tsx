"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/*
 * Switch — Radix Switch (role="switch" + aria-checked, unchanged API) with the Untitled UI React
 * toggle proportions (`components/base/toggle/toggle.tsx`, MIT) and the transitions.dev
 * 27-toggle spring (t-toggle). Visible track is 36×20 (sm) / 44×24 (md); the hit area is 40px tall.
 */

const sizes = {
  sm: { root: "h-10 w-9", track: "h-5 w-9", thumb: "size-4 -mt-2", travel: "[--toggle-travel:16px]" },
  md: { root: "h-10 w-11", track: "h-6 w-11", thumb: "size-5 -mt-2.5", travel: "[--toggle-travel:20px]" },
} as const

function Switch({
  className,
  checked,
  defaultChecked,
  onCheckedChange,
  size = "sm",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: keyof typeof sizes }) {
  const [value, setValue] = React.useState(defaultChecked ?? false)
  const [interacted, setInteracted] = React.useState(false)
  const on = checked ?? value
  const s = sizes[size]
  return (
    <SwitchPrimitive.Root
      className={cn(
        "group/switch relative inline-flex shrink-0 cursor-pointer items-center outline-none disabled:cursor-not-allowed",
        s.root,
        "t-toggle steplab-switch",
        s.travel,
        interacted && "is-init",
        className,
      )}
      data-slot="switch"
      data-on={String(on)}
      checked={on}
      onCheckedChange={(next) => { setInteracted(true); setValue(next); onCheckedChange?.(next) }}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-tertiary ring-1 ring-control ring-inset transition-[background-color,box-shadow] duration-150 ease-out",
          "group-hover/switch:ring-control_hover group-data-[state=checked]/switch:bg-brand-solid group-data-[state=checked]/switch:ring-transparent group-hover/switch:group-data-[state=checked]/switch:bg-brand-solid_hover",
          "group-focus-visible/switch:outline-2 group-focus-visible/switch:outline-offset-2 group-focus-visible/switch:outline-focus-ring",
          "group-disabled/switch:bg-secondary group-disabled/switch:ring-secondary group-disabled/switch:group-data-[state=checked]/switch:bg-brand-solid/40",
          s.track,
        )}
      />
      <SwitchPrimitive.Thumb
        className={cn(
          "t-toggle-thumb pointer-events-none absolute top-1/2 left-0.5 z-10 block rounded-full bg-white shadow-sm ring-1 ring-black/5",
          "group-disabled/switch:shadow-none",
          s.thumb,
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
