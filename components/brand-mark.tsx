import Image from "next/image";
import type { ComponentProps } from "react";

import brandMark from "@/components/brand/rag-steplab-mark.png";
import { cn } from "@/lib/utils";

/** The product mark (glass flask with stepped chunks); one raster source for the UI, icons and the share card. */
export const BRAND_MARK_SRC = brandMark;

/** Decorative product mark; size it with a `size-*` class (28px by default). */
export function BrandMark({ className, ...props }: Omit<ComponentProps<typeof Image>, "src" | "alt">) {
  return (
    <Image
      alt=""
      aria-hidden="true"
      className={cn("size-7 shrink-0 object-contain", className)}
      data-slot="brand-mark"
      draggable={false}
      height={56}
      priority
      src={brandMark}
      width={56}
      {...props}
    />
  );
}
