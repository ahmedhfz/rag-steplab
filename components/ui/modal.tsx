"use client";

import type { ComponentProps, ReactNode } from "react";
import { AlertDialog as AlertPrimitive, Dialog as DialogPrimitive } from "radix-ui";

import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { FeaturedIcon, type FeaturedIconColor } from "@/components/ui/featured-icon";
import { TransitionAlertDialogContent, TransitionDialogContent } from "@/components/ui/transition-surface";
import { useCopy } from "@/lib/copy";
import { cn } from "@/lib/utils";

/*
 * Modal + AlertDialog — Untitled UI React modal layout (`components/application/modals/modal.tsx`,
 * MIT: header with featured icon, body, right-aligned footer) on Radix Dialog / AlertDialog
 * (focus trap, Escape, scroll lock, aria wiring). Motion: transitions.dev 06-modal recipe (t-modal)
 * and the steplab-overlay fade, both reduced-motion aware.
 */

export type ModalSize = "sm" | "md" | "lg" | "xl";

const widths: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

const overlay = "steplab-overlay fixed inset-0 z-50 bg-overlay/40 backdrop-blur-xs dark:bg-overlay/70";
const surface = "pointer-events-auto relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl bg-primary shadow-xl ring-1 ring-secondary_alt outline-none";

type HeaderProps = { title: ReactNode; description?: ReactNode; icon?: SemanticIconName; iconColor?: FeaturedIconColor };

function Header({ title, description, icon, iconColor = "gray", Title, Description }: HeaderProps & { Title: typeof DialogPrimitive.Title; Description: typeof DialogPrimitive.Description }) {
  return (
    <header className="flex flex-col gap-4 px-6 pt-6 pr-14">
      {icon ? <FeaturedIcon color={iconColor} icon={icon} size="lg" theme={iconColor === "gray" ? "modern" : "light"} /> : null}
      <div className="flex flex-col gap-1">
        <Title className="text-lg font-semibold text-primary">{title}</Title>
        {description ? <Description className="text-sm text-tertiary">{description}</Description> : null}
      </div>
    </header>
  );
}

/* ----------------------------------- Modal ----------------------------------- */

export const Modal = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalClose = DialogPrimitive.Close;

export type ModalContentProps = Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> & HeaderProps & {
  size?: ModalSize;
  /** Hide the top-right close button (Escape and overlay click still close). */
  hideClose?: boolean;
};

export function ModalContent({ title, description, icon, iconColor, size = "md", hideClose = false, className, children, ...props }: ModalContentProps) {
  const copy = useCopy();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlay} />
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
        <TransitionDialogContent {...props} className={cn(surface, widths[size], className)} data-slot="modal">
          <Header Description={DialogPrimitive.Description} Title={DialogPrimitive.Title} description={description} icon={icon} iconColor={iconColor} title={title} />
          {children}
          {hideClose ? null : (
            <DialogPrimitive.Close asChild>
              <Button aria-label={copy.common.close} className="absolute top-3 right-3" size="icon-sm" variant="tertiary"><AppIcon name="close" /></Button>
            </DialogPrimitive.Close>
          )}
        </TransitionDialogContent>
      </div>
    </DialogPrimitive.Portal>
  );
}

export function ModalBody({ className, ...props }: ComponentProps<"div">) {
  return <div {...props} className={cn("min-h-0 flex-1 overflow-y-auto px-6 pt-5 text-sm text-secondary", className)} data-slot="modal-body" />;
}

export function ModalFooter({ className, ...props }: ComponentProps<"footer">) {
  return <footer {...props} className={cn("flex flex-col-reverse gap-3 px-6 pt-8 pb-6 sm:flex-row sm:justify-end", className)} data-slot="modal-footer" />;
}

/* -------------------------------- AlertDialog -------------------------------- */
/* role="alertdialog": requires an explicit choice; overlay clicks do not dismiss. */

export const AlertDialog = AlertPrimitive.Root;
export const AlertDialogTrigger = AlertPrimitive.Trigger;
export const AlertDialogCancel = AlertPrimitive.Cancel;
export const AlertDialogAction = AlertPrimitive.Action;

export type AlertDialogContentProps = Omit<ComponentProps<typeof AlertPrimitive.Content>, "title"> & HeaderProps & { size?: ModalSize };

export function AlertDialogContent({ title, description, icon, iconColor, size = "sm", className, children, ...props }: AlertDialogContentProps) {
  return (
    <AlertPrimitive.Portal>
      <AlertPrimitive.Overlay className={overlay} />
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
        <TransitionAlertDialogContent {...props} className={cn(surface, widths[size], className)} data-slot="alert-dialog">
          <Header Description={AlertPrimitive.Description} Title={AlertPrimitive.Title} description={description} icon={icon} iconColor={iconColor} title={title} />
          {children}
        </TransitionAlertDialogContent>
      </div>
    </AlertPrimitive.Portal>
  );
}

export type ConfirmDialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional trigger element (rendered asChild). */
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  /** `destructive` for irreversible actions (delete, reset), `primary` otherwise. */
  tone?: "destructive" | "primary";
  icon?: SemanticIconName;
  onConfirm: () => void;
  isLoading?: boolean;
};

/** Ready-made confirmation: icon, title, description, Cancel + Confirm. */
export function ConfirmDialog({ open, onOpenChange, trigger, title, description, confirmLabel, cancelLabel, tone = "destructive", icon, onConfirm, isLoading }: ConfirmDialogProps) {
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent description={description} icon={icon ?? (tone === "destructive" ? "trash" : "info")} iconColor={tone === "destructive" ? "error" : "brand"} title={title}>
        <ModalFooter>
          <AlertDialogCancel asChild><Button size="lg" variant="secondary">{cancelLabel}</Button></AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button isLoading={isLoading} onClick={onConfirm} size="lg" variant={tone === "destructive" ? "destructive" : "primary"}>{confirmLabel}</Button>
          </AlertDialogAction>
        </ModalFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
