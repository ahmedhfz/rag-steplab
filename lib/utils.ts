import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// app/theme.css adds Untitled's type scale (md, display-*) and skeuomorphic shadows;
// without this, tailwind-merge reads `text-display-xs` as a colour and drops it next to `text-primary`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["2xs", "md", "display-xs", "display-sm", "display-md", "display-lg", "display-xl", "display-2xl"],
      shadow: ["skeuomorphic", "xs-skeuomorphic"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
