import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-[10px] border border-[#d8d2d5] bg-white px-3 py-1 text-sm text-[#171416] shadow-none transition-[color,box-shadow,border-color] outline-none selection:bg-[#f1dce3] selection:text-[#501329] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-[#969093] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-[#711f3a] focus-visible:ring-[3px] focus-visible:ring-[#711f3a]/15",
        "aria-invalid:border-[#a23b3b] aria-invalid:ring-[#a23b3b]/20",
        className
      )}
      {...props}
    />
  )
}

export { Input }
