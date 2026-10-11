import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** Keyboard key hint, e.g. <Kbd>⌘</Kbd><Kbd>K</Kbd>. Tactile: a 1px bottom edge like a keycap. */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      {...props}
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-primary px-1.5 font-sans text-xs font-medium text-tertiary",
        "shadow-[inset_0_-1px_0_var(--color-border-primary)] ring-1 ring-secondary ring-inset",
        className,
      )}
      data-slot="kbd"
    />
  );
}
