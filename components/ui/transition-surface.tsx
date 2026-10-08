"use client";

import { forwardRef, useCallback, useRef, type ComponentProps } from "react";
import { Dialog, Select } from "radix-ui";

import { cn } from "@/lib/utils";

/** Attach on the actual portal node: Select may mount it after this wrapper. */
export function useRadixTransition() {
  const disconnect = useRef<(() => void) | null>(null);
  return useCallback((element: HTMLDivElement | null) => {
    disconnect.current?.();
    disconnect.current = null;
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
    disconnect.current = () => { observer.disconnect(); };
  }, []);
}

export const TransitionDialogContent = forwardRef<HTMLDivElement, ComponentProps<typeof Dialog.Content>>(function TransitionDialogContent({ className, ...props }, forwardedRef) {
  const setTransitionNode = useRadixTransition();
  const ref = useCallback((element: HTMLDivElement | null) => {
    setTransitionNode(element);
    if (typeof forwardedRef === "function") forwardedRef(element);
    else if (forwardedRef) forwardedRef.current = element;
  }, [forwardedRef, setTransitionNode]);
  return <Dialog.Content {...props} className={cn("t-modal", className)} ref={ref} />;
});

export const TransitionSelectContent = forwardRef<HTMLDivElement, ComponentProps<typeof Select.Content>>(function TransitionSelectContent({ className, ...props }, forwardedRef) {
  const setTransitionNode = useRadixTransition();
  const ref = useCallback((element: HTMLDivElement | null) => {
    setTransitionNode(element);
    if (typeof forwardedRef === "function") forwardedRef(element);
    else if (forwardedRef) forwardedRef.current = element;
  }, [forwardedRef, setTransitionNode]);
  return <Select.Content {...props} className={cn("t-dropdown steplab-select", className)} ref={ref} />;
});
