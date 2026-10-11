"use client";

import { AppIcon } from "@/components/ui/app-icon";

export function PipelineErrorMessage({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p className="rounded-md border border-destructive-border bg-destructive-subtle px-3 py-2 text-xs text-destructive" role="alert">{message}</p>;
}

export function DisabledReason({ id, children }: { id: string; children: React.ReactNode }) {
  return <p className="mt-2 text-xs leading-5 text-muted-foreground" id={id}>{children}</p>;
}

export function EmptyPipelineState({ children }: { children: React.ReactNode }) {
  return (
    <div aria-live="polite" className="flex min-h-24 items-center justify-center gap-2 border-y border-border px-5 py-7 text-center text-sm text-muted-foreground">
      <AppIcon name="clock" className="size-4 shrink-0" />{children}
    </div>
  );
}
