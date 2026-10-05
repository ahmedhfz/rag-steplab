"use client";

import { forwardRef, useLayoutEffect, useRef, type ComponentProps, type RefObject } from "react";
import { Dialog, Select } from "radix-ui";

import { cn } from "@/lib/utils";

/** Radix owns mount/focus/Escape; transitions.dev owns the surface motion. */
export function useRadixTransition(ref: RefObject<HTMLDivElement | null>, kind: "modal" | "dropdown") {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const sync = () => {
      const closing = element.dataset.state === "closed";
      element.toggleAttribute("inert", closing);
      element.classList.remove("is-open", "is-closing");
      if (!closing) void element.offsetWidth;
      element.classList.add(closing ? "is-closing" : "is-open");
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(element, { attributes: true, attributeFilter: ["data-state"] });
    return () => { observer.disconnect(); element.classList.remove("is-closing"); };
  }, [ref, kind]);
}

export const TransitionDialogContent = forwardRef<HTMLDivElement, ComponentProps<typeof Dialog.Content>>(function TransitionDialogContent({ className, ...props }, forwardedRef) {
  const ref = useRef<HTMLDivElement>(null);
  useRadixTransition(ref, "modal");
  return <Dialog.Content {...props} className={cn("t-modal", className)} ref={(element) => {
    ref.current = element;
    if (typeof forwardedRef === "function") forwardedRef(element);
    else if (forwardedRef) forwardedRef.current = element;
  }} />;
});

export const TransitionSelectContent = forwardRef<HTMLDivElement, ComponentProps<typeof Select.Content>>(function TransitionSelectContent({ className, ...props }, forwardedRef) {
  const ref = useRef<HTMLDivElement>(null);
  useRadixTransition(ref, "dropdown");
  return <Select.Content {...props} className={cn("t-dropdown steplab-select", className)} ref={(element) => {
    ref.current = element;
    if (typeof forwardedRef === "function") forwardedRef(element);
    else if (forwardedRef) forwardedRef.current = element;
  }} />;
});
