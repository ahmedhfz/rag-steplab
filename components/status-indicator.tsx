"use client";

import { IconSwap, SuccessCheck, TransitionText } from "@/components/ui/transitions";


import { usePreferences } from "@/components/preferences-provider";
import { AppIcon } from "@/components/ui/app-icon";
import { UI_COPY } from "@/lib/copy";
import type { PipelineStepState } from "@/lib/rag-ui-types";
import { cn } from "@/lib/utils";

const stateStyles: Record<PipelineStepState, string> = {
  "Not started": "text-muted-foreground",
  Ready: "text-brand",
  Completed: "text-success",
  Skipped: "text-subtle-foreground",
  Processing: "text-warning",
  Error: "text-destructive",
  Locked: "text-subtle-foreground",
  Stale: "text-warning",
};

function StateIcon({ state }: { state: PipelineStepState }) {
  if (state === "Completed") return <SuccessCheck className="size-4" />;
  if (state === "Not started") return <AppIcon name="circle" className="size-4" />;
  if (state === "Ready") return <AppIcon name="ready" className="size-4" />;
  if (state === "Processing") return <AppIcon name="loading" className="size-4 animate-spin" />;
  if (state === "Error") return <AppIcon name="warning" className="size-4" />;
  if (state === "Skipped") return <AppIcon name="minus" className="size-4" />;
  if (state === "Stale") return <AppIcon name="history" className="size-4" />;
  return <AppIcon name="lock" className="size-3.5" />;
}

export function StatusIndicator({ state, compact = false }: { state: PipelineStepState; compact?: boolean }) {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", stateStyles[state])}>
      <IconSwap active={state === "Completed"} first={<StateIcon state={state === "Completed" ? "Ready" : state} />} second={state === "Completed" ? <SuccessCheck className="size-4" /> : null} />
      {!compact && <TransitionText>{copy.status[state]}</TransitionText>}
    </span>
  );
}

