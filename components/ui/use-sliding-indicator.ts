"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Slides one indicator element to the selected item inside a container (segmented pill,
 * tab underline). Same idea as `SlidingTabs` (transitions.dev 16-tabs-sliding), but it watches
 * the DOM selection attributes, so it also follows uncontrolled React Aria state.
 * Timing comes from the CSS on the indicator (`--tabs-dur`, `--tabs-ease`); the first placement
 * and resizes jump without animating. Reduced motion is handled by the global rule.
 */
export function useSlidingIndicator<C extends HTMLElement>(selector: string, mode: "fill" | "underline" = "fill") {
  const containerRef = useRef<C>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;

    const move = (animate: boolean) => {
      const target = container.querySelector<HTMLElement>(selector);
      if (!target) {
        indicator.style.opacity = "0";
        return;
      }
      const box = container.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      const previous = indicator.style.transition;
      if (!animate) indicator.style.transition = "none";
      indicator.style.opacity = "1";
      const top = mode === "underline" ? rect.bottom - box.top - 2 : rect.top - box.top;
      indicator.style.translate = `${rect.left - box.left}px ${top}px`;
      indicator.style.width = `${rect.width}px`;
      indicator.style.height = mode === "underline" ? "2px" : `${rect.height}px`;
      if (!animate) {
        void indicator.offsetWidth;
        indicator.style.transition = previous;
      }
    };

    move(false);
    const selection = new MutationObserver(() => move(true));
    selection.observe(container, { attributes: true, subtree: true, attributeFilter: ["data-selected", "aria-selected", "aria-checked"] });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => move(false));
    resize?.observe(container);
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) move(false); });
    return () => {
      alive = false;
      selection.disconnect();
      resize?.disconnect();
    };
  }, [selector, mode]);

  return { containerRef, indicatorRef };
}
