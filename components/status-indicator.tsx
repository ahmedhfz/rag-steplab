"use client";

import { AlertCircle, CheckCircle2, Circle, CircleDot, Forward, History, LoaderCircle, LockKeyhole } from "lucide-react";
import { motion } from "motion/react";

import { usePreferences } from "@/components/preferences-provider";
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
  if (state === "Completed") {
    return (
      <motion.span
        animate={{ opacity: 1, scale: 1 }}
        initial={{ opacity: 0, scale: 0.7 }}
        transition={{ type: "spring", stiffness: 480, damping: 22 }}
      >
        <CheckCircle2 aria-hidden="true" className="size-4" />
      </motion.span>
    );
  }
  if (state === "Not started") return <Circle aria-hidden="true" className="size-4" />;
  if (state === "Ready") return <CircleDot aria-hidden="true" className="size-4" />;
  if (state === "Processing") {
    return (
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ duration: 0.9, ease: "linear", repeat: Infinity }}
      >
        <LoaderCircle aria-hidden="true" className="size-4" />
      </motion.span>
    );
  }
  if (state === "Error") return <AlertCircle aria-hidden="true" className="size-4" />;
  if (state === "Skipped") return <Forward aria-hidden="true" className="size-4" />;
  if (state === "Stale") return <History aria-hidden="true" className="size-4" />;
  return <LockKeyhole aria-hidden="true" className="size-3.5" />;
}

export function StatusIndicator({ state, compact = false }: { state: PipelineStepState; compact?: boolean }) {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", stateStyles[state])}>
      <StateIcon key={state} state={state} />
      {!compact && copy.status[state]}
    </span>
  );
}
