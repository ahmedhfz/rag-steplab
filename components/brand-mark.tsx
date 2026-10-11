import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/** Flask geometry on a 28×28 grid; the single source for the UI mark and generated icons. */
export const BRAND_MARK_VIEWBOX = "0 0 28 28";

const FLASK_PATH =
  "M11.37 3.5h5.24M11.8 3.5v5.42l-5.15 9.79a2.76 2.76 0 0 0 2.36 4.02h9.96a2.76 2.76 0 0 0 2.36-4.02L16.18 8.92V3.5";
const LEVEL_PATH = "M9.27 16.18h9.44";
const BUBBLES = [
  { cx: 12.24, cy: 18.89, r: 1.01, opacity: 0.8 },
  { cx: 15.74, cy: 19.76, r: 0.79, opacity: 0.6 },
  { cx: 13.99, cy: 20.98, r: 0.66, opacity: 1 },
] as const;

/**
 * Plain SVG children in one color. Also used by `next/og` routes, which only
 * render intrinsic elements with explicit colors.
 */
export function brandMarkShapes(color: string, strokeWidth = 1.5) {
  return [
    <path d={FLASK_PATH} key="flask" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={strokeWidth} />,
    <path d={LEVEL_PATH} key="level" stroke={color} strokeLinecap="round" strokeWidth={strokeWidth} />,
    ...BUBBLES.map(({ opacity, ...circle }) => (
      <circle {...circle} fill={color} fillOpacity={opacity} key={`${circle.cx}-${circle.cy}`} />
    )),
  ];
}

/** Decorative product mark; color comes from `currentColor` (brand token by default). */
export function BrandMark({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      aria-hidden="true"
      className={cn("size-7 shrink-0 text-brand", className)}
      data-slot="brand-mark"
      fill="none"
      focusable="false"
      viewBox={BRAND_MARK_VIEWBOX}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {brandMarkShapes("currentColor")}
    </svg>
  );
}
