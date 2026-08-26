import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 ease-out outline-none active:scale-[0.98] focus-visible:border-[#711f3a] focus-visible:ring-[3px] focus-visible:ring-[#711f3a]/20 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-[#a23b3b] aria-invalid:ring-[#a23b3b]/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-[#171416] text-white hover:bg-[#2b2729]",
        destructive:
          "bg-[#a23b3b] text-white hover:bg-[#8d3232] focus-visible:ring-[#a23b3b]/20",
        outline:
          "border border-[#e7e2e4] bg-white text-[#171416] hover:border-[#711f3a] hover:bg-[#fbf4f6] hover:text-[#501329]",
        secondary:
          "bg-[#f2eff0] text-[#171416] hover:bg-[#e7e2e4]",
        ghost:
          "hover:bg-[#fbf4f6] hover:text-[#501329]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        xs: "h-7 gap-1 rounded-[8px] px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 rounded-[9px] px-3 has-[>svg]:px-2.5",
        lg: "h-11 rounded-[10px] px-6 has-[>svg]:px-4",
        icon: "size-10",
        "icon-xs": "size-7 rounded-[8px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }>(function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}, ref) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
})

Button.displayName = "Button"

export { Button, buttonVariants }
