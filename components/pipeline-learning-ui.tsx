"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { usePreferences } from "@/components/preferences-provider";
import { StageBlocker } from "@/components/stage-blocker";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { Disclosure, TechnicalDetails } from "@/components/ui/disclosure";
import { StatusPill } from "@/components/ui/status-pill";
import type { PipelineAvailability } from "@/lib/blockers";
import { interpolate, runName, useCopy } from "@/lib/copy";
import { formatMs } from "@/lib/format";
import { completedCompatibleRun } from "@/lib/pipeline-lineage";
import type { RunSummary } from "@/lib/rag-api-types";
import { cn } from "@/lib/utils";

export function PipelineErrorMessage({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <p className="rounded-md border border-destructive-border bg-destructive-subtle px-3 py-2 text-xs text-destructive" role="alert">{message}</p>;
}

export function DisabledReason({ id, children }: { id: string; children: React.ReactNode }) {
  return <p className="mt-2 text-xs leading-5 text-muted-foreground" id={id}>{children}</p>;
}

export type RunKind = "parse" | "chunk" | "embedding";

const historyTestId: Record<RunKind, string> = { parse: "parse-history", chunk: "chunk-history", embedding: "embedding-history" };

/** Opens a stage's run history and brings it into view (the incompatible-lineage way out). */
export function revealRunHistory(kind: RunKind) {
  const section = document.getElementById(historyTestId[kind]);
  const details = section?.querySelector("details");
  if (details && !details.open) details.open = true;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  section?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/**
 * A stage blocker with its way out: a link to the unblocking page, or for an
 * incompatible lineage a button that opens this stage's history. Loading and
 * processing render nothing; the action itself already shows that state.
 */
export function StageBlockerRow({ blocker, kind, id, testId, className }: { blocker: PipelineAvailability | null | undefined; kind: RunKind; id?: string; testId?: string; className?: string }) {
  const copy = useCopy();
  if (!blocker || blocker.allowed || !blocker.code || blocker.code === "loading" || blocker.code === "processing") return null;
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1", className)}>
      <StageBlocker blocker={blocker} data-testid={testId} id={id} />
      {blocker.code === "incompatible_lineage" ? (
        <button className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline" data-testid={`${kind}-open-history`} onClick={() => revealRunHistory(kind)} type="button">
          {copy.runs.openHistory}
          <AppIcon name="arrowRight" className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The stage footer: the next step stays visible even while locked, with the
 * reason and the action that unlocks it. `emphasis` keeps one primary action
 * per page (secondary while the stage has unapplied changes).
 */
export function StageNextAction({ href, label, disabled, testId, blocker, reason, emphasis = "primary" }: {
  href: string;
  label: string;
  disabled: boolean;
  testId: string;
  /** Availability of the next stage; when blocked its message and CTA explain why. */
  blocker?: PipelineAvailability | null;
  /** Fallback explanation when the next stage is locked for a stage-local reason. */
  reason: string;
  emphasis?: "primary" | "secondary";
}) {
  const pathname = usePathname();
  const reasonId = `${testId}-reason`;
  const variant = emphasis === "primary" ? "default" : "outline";
  // A blocker that points back at this page restates the stage's own job; the
  // stage reason says it better. Blockers elsewhere (or without a page) win.
  const showBlocker = Boolean(blocker && !blocker.allowed && blocker.code && blocker.code !== "loading" && blocker.code !== "processing"
    && (!blocker.href || blocker.href !== pathname));
  return (
    <footer className="mt-8 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-t border-border pt-5" data-testid={`${testId}-footer`}>
      {disabled ? (showBlocker
        ? <StageBlocker blocker={blocker} className="min-w-0 flex-1 justify-end text-right" id={reasonId} />
        : <p className="min-w-0 flex-1 text-right text-sm text-muted-foreground" id={reasonId}>{reason}</p>) : null}
      {disabled ? (
        <Button aria-describedby={reasonId} data-testid={testId} disabled variant={variant}>{label}<AppIcon name="arrowRight" className="size-4" /></Button>
      ) : (
        <Button asChild data-testid={testId} variant={variant}>
          <Link href={href}>{label}<AppIcon name="arrowRight" className="size-4" /></Link>
        </Button>
      )}
    </footer>
  );
}

/**
 * Persistent inspect-mode band: an inspected historical run is on screen while
 * the pipeline keeps using another one. Use and back actions are explicit.
 */
export function InspectionBand({ kind, runs, selectedId, inspectedId, canUse, onUse, onBack }: {
  kind: RunKind;
  runs: RunSummary[];
  selectedId: string | null;
  inspectedId: string | null;
  canUse: boolean;
  onUse: (runId: string) => unknown;
  onBack: (runId: string) => unknown;
}) {
  const copy = useCopy();
  if (!inspectedId || inspectedId === selectedId) return null;
  const inspected = runs.find((run) => run.id === inspectedId);
  const selected = selectedId ? runs.find((run) => run.id === selectedId) : undefined;
  const inspectedName = runName(copy, kind, inspected?.runNumber);
  const text = selectedId
    ? interpolate(copy.runs.inspectionBand, { inspected: inspectedName, selected: runName(copy, kind, selected?.runNumber) })
    : interpolate(copy.runs.inspectionBandEmpty, { inspected: inspectedName });
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-warning-border bg-warning-subtle px-4 py-2.5" data-testid={`${kind}-inspection-band`} role="status">
      <p className="flex min-w-0 items-center gap-2 text-sm text-foreground"><AppIcon name="eye" className="size-4 shrink-0 text-warning" />{text}</p>
      <div className="flex flex-wrap gap-2">
        {canUse && completedCompatibleRun(inspected) ? <Button onClick={() => void onUse(inspectedId)} size="sm">{copy.runs.useInPipeline}</Button> : null}
        {selectedId ? <Button onClick={() => void onBack(selectedId)} size="sm" variant="outline">{copy.runs.backToPipeline}</Button> : null}
      </div>
    </div>
  );
}

/**
 * One run history for every stage (Q12): In use · Inspecting · Document
 * default · Historical. "Selected"/"Compatible" stay silent; only an
 * unusable run explains itself. Raw IDs and durations live in Technical details.
 */
export function RunHistory({ kind, runs, selectedId, inspectedId, defaultId, hasPipeline, onInspect, onUse }: {
  kind: RunKind;
  runs: RunSummary[];
  selectedId: string | null;
  inspectedId?: string | null;
  defaultId: string | null | undefined;
  /** With a saved pipeline the row action only inspects; without one it selects. */
  hasPipeline: boolean;
  onInspect: (runId: string) => unknown;
  onUse?: (runId: string) => unknown;
}) {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const ordered = useMemo(
    () => [...runs].sort((a, b) => (b.runNumber ?? 0) - (a.runNumber ?? 0) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))),
    [runs],
  );
  if (!ordered.length) return null;
  const viewedId = inspectedId ?? selectedId;

  return (
    <section className="mt-8 scroll-mt-6" data-testid={historyTestId[kind]} id={historyTestId[kind]}>
      <Disclosure contentClassName="divide-y divide-border p-0" meta={ordered.length} title={copy.runs.history[kind]}>
        {ordered.map((run) => {
          const usable = completedCompatibleRun(run);
          const isSelected = run.id === selectedId;
          const isViewed = run.id === viewedId;
          const problem = run.status === "queued" || run.status === "running"
            ? copy.runs.running
            : run.status === "failed"
              ? copy.runs.failed
              : !run.isCompatible
                ? copy.runs.incompatible
                : null;
          return (
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`${historyTestId[kind]}-row`} key={run.id}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-medium text-foreground tabular-nums">{runName(copy, kind, run.runNumber)}</span>
                  {isSelected ? <StatusPill tone="neutral">{copy.runs.inUse}</StatusPill> : null}
                  {!isSelected && isViewed ? <StatusPill tone="warning">{copy.runs.inspecting}</StatusPill> : null}
                  {!isSelected && run.id === defaultId ? <StatusPill tone="idle">{copy.runs.documentDefault}</StatusPill> : null}
                  {run.historicalLineage ? <StatusPill tone="warning">{copy.runs.historical}</StatusPill> : null}
                </div>
                {problem ? <p className={cn("mt-1 text-xs", run.status === "failed" ? "text-destructive" : run.isCompatible ? "text-muted-foreground" : "text-warning")}>{problem}</p> : null}
                {run.error?.message ? <p className="mt-1 text-xs text-destructive">{run.error.message}</p> : null}
                {!run.isCompatible && run.compatibilityReason ? <p className="mt-1 text-xs text-warning">{run.compatibilityReason}</p> : null}
                <TechnicalDetails className="mt-1">
                  <dl className="grid gap-1 text-xs text-muted-foreground">
                    {run.timing.durationMs != null ? <div className="flex gap-2"><dt>{copy.runs.duration}</dt><dd className="tabular-nums text-foreground">{formatMs(preferences.locale, run.timing.durationMs)}</dd></div> : null}
                    <div className="flex min-w-0 gap-2"><dt className="shrink-0">{copy.runs.runId}</dt><dd className="min-w-0 font-mono text-foreground [overflow-wrap:anywhere]">{run.id}</dd></div>
                  </dl>
                </TechnicalDetails>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {usable && !isViewed ? <Button onClick={() => void onInspect(run.id)} size="sm" variant="outline">{hasPipeline ? copy.runs.inspect : copy.runs.select}</Button> : null}
                {onUse && hasPipeline && usable && isViewed && !isSelected ? <Button onClick={() => void onUse(run.id)} size="sm" variant="outline">{copy.runs.useInPipeline}</Button> : null}
              </div>
            </div>
          );
        })}
      </Disclosure>
    </section>
  );
}
