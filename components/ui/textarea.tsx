import type { ComponentProps } from "react";

import { fieldSurface } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* Textarea — Untitled UI React `components/base/textarea/textarea.tsx` look (MIT) on a native <textarea>. */
export function Textarea({ className, rows = 4, ...props }: ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" rows={rows} {...props} className={cn(fieldSurface, "min-h-20 resize-y px-3 py-2 leading-6 sm:not-pointer-coarse:leading-5", className)} />;
}
