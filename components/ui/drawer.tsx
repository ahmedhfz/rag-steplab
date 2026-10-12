"use client";

import type { ComponentProps, ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/*
 * Drawer (sheet) — Untitled UI React slideout-menu layout (`components/application/slideout-menus`,
 * MIT: header / scrolling content / footer with an inset top rule) on Radix Dialog.
 * Slides from the right (default), left or bottom using the transitions.dev panel timing
 * (`--panel-open-dur`, `--panel-ease`); see `.steplab-drawer` in transition-adapters.css.
 */

export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;

export type DrawerSide = "right" | "left" | "bottom";

const sides: Record<DrawerSide, string> = {
  right: "inset-y-2 right-2 w-[min(100vw-1rem,28rem)] rounded-2xl",
  left: "inset-y-2 left-2 w-[min(100vw-1rem,28rem)] rounded-2xl",
  bottom: "inset-x-2 bottom-2 max-h-[85dvh] rounded-2xl",
};

export type DrawerContentProps = Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  side?: DrawerSide;
};

export function DrawerContent({ title, description, side = "right", className, children, ...props }: DrawerContentProps) {
  const copy = useCopy();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="steplab-overlay fixed inset-0 z-50 bg-overlay/40 dark:bg-overlay/60" />
      <DialogPrimitive.Content
        {...props}
        className={cn("steplab-drawer fixed z-50 flex flex-col overflow-hidden bg-primary shadow-2xl ring-1 ring-secondary_alt outline-none", sides[side], className)}
        data-side={side}
        data-slot="drawer"
      >
        <header className="relative flex flex-col gap-1 px-5 pt-5 pr-14 pb-4">
          <DialogPrimitive.Title className="text-lg font-semibold text-primary">{title}</DialogPrimitive.Title>
          {description ? <DialogPrimitive.Description className="text-sm text-tertiary">{description}</DialogPrimitive.Description> : null}
          <DialogPrimitive.Close asChild>
            <Button aria-label={copy.common.close} className="absolute top-3 right-3" size="icon-sm" variant="tertiary"><AppIcon name="close" /></Button>
          </DialogPrimitive.Close>
        </header>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DrawerBody({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("technical-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-5 text-sm text-secondary", className)} data-slot="drawer-body" />;
}

export function DrawerFooter({ className, ...props }: ComponentProps<"footer">) {
  return <footer {...props} className={cn("flex justify-end gap-3 px-5 py-4 shadow-[inset_0_1px_0_var(--color-border-secondary)]", className)} data-slot="drawer-footer" />;
}
