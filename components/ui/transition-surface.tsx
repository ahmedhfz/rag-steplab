"use client";

import { forwardRef, useCallback, useRef, type ComponentProps, type ForwardedRef } from "react";
import { AlertDialog, Dialog, HoverCard, Select } from "radix-ui";

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

function assignRef<T>(ref: ForwardedRef<T>, value: T) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/** Radix content node + transitions.dev recipe state classes, merged with the caller's ref. */
function useTransitionRef(forwardedRef: ForwardedRef<HTMLDivElement>) {
  const setTransitionNode = useRadixTransition();
  return useCallback((element: HTMLDivElement | null) => {
    setTransitionNode(element);
    assignRef(forwardedRef, element);
  }, [forwardedRef, setTransitionNode]);
}

export const TransitionDialogContent = forwardRef<HTMLDivElement, ComponentProps<typeof Dialog.Content>>(function TransitionDialogContent({ className, ...props }, forwardedRef) {
  const ref = useTransitionRef(forwardedRef);
  return <Dialog.Content {...props} className={cn("t-modal", className)} ref={ref} />;
});

export const TransitionAlertDialogContent = forwardRef<HTMLDivElement, ComponentProps<typeof AlertDialog.Content>>(function TransitionAlertDialogContent({ className, ...props }, forwardedRef) {
  const ref = useTransitionRef(forwardedRef);
  return <AlertDialog.Content {...props} className={cn("t-modal", className)} ref={ref} />;
});

export const TransitionSelectContent = forwardRef<HTMLDivElement, ComponentProps<typeof Select.Content>>(function TransitionSelectContent({ className, ...props }, forwardedRef) {
  const ref = useTransitionRef(forwardedRef);
  return <Select.Content {...props} className={cn("t-dropdown steplab-select", className)} ref={ref} />;
});

export const TransitionHoverCardContent = forwardRef<HTMLDivElement, ComponentProps<typeof HoverCard.Content>>(function TransitionHoverCardContent({ className, ...props }, forwardedRef) {
  const ref = useTransitionRef(forwardedRef);
  return <HoverCard.Content {...props} className={cn("t-dropdown steplab-hovercard", className)} ref={ref} />;
});
