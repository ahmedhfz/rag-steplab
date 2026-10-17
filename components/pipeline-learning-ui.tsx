"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { usePreferences } from "@/components/preferences-provider";
import { StageBlocker } from "@/components/stage-blocker";
import { AppIcon } from "@/components/ui/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure, TechnicalDetails } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import { describeApiError } from "@/lib/api-errors";
import type { PipelineAvailability } from "@/lib/blockers";
import { type AppCopy, type AppLocale, interpolate, runName, useCopy } from "@/lib/copy";
import { formatCount, formatMs } from "@/lib/format";
import { completedCompatibleRun } from "@/lib/pipeline-lineage";
import type { ChunkStrategy, RunSummary } from "@/lib/rag-api-types";
import { cn } from "@/lib/utils";

export function DisabledReason({ id, children }: { id: string; children: React.ReactNode }) {
  return <p className="mt-2 text-sm text-tertiary" id={id}>{children}</p>;
}

export type RunKind = "parse" | "chunk" | "embedding";

const historyTestId: Record<RunKind, string> = { parse: "parse-history", chunk: "chunk-history", embedding: "embedding-history" };
/** What a failed run of this stage means when its code has no copy of its own. */
const runFailedCopy: Record<RunKind, (copy: AppCopy) => string> = {
  parse: (copy) => copy.errors.parseFailed,
  chunk: (copy) => copy.errors.chunkingFailed,
  embedding: (copy) => copy.errors.embeddingFailed,
};

/** Opens a stage's run history and brings it into view (the incompatible-lineage way out). */
export function revealRunHistory(kind: RunKind) {
  const section = document.getElementById(historyTestId[kind]);
  const details = section?.querySelector("details");
  if (details && !details.open) details.open = true;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  section?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/** Whether StageBlockerRow renders anything for this availability (for aria-describedby wiring). */
export function hasVisibleBlocker(blocker: PipelineAvailability | null | undefined): blocker is PipelineAvailability {
  return Boolean(blocker && !blocker.allowed && blocker.code && blocker.code !== "loading" && blocker.code !== "processing");
}

/**
 * A stage blocker with its way out: a link to the unblocking page, or for an
 * incompatible lineage a button that opens this stage's history. Loading and
 * processing render nothing; the action itself already shows that state.
 */
export function StageBlockerRow({ blocker, kind, id, testId, className }: { blocker: PipelineAvailability | null | undefined; kind: RunKind; id?: string; testId?: string; className?: string }) {
  const copy = useCopy();
  if (!hasVisibleBlocker(blocker)) return null;
  const incompatible = blocker.code === "incompatible_lineage";
  // "Open history" is the way out here, so the message does not also say "select a result from its history".
  const shown = incompatible ? { ...blocker, message: copy.runs.incompatibleLineage } : blocker;
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <StageBlocker blocker={shown} data-testid={testId} id={id} />
      {incompatible ? (
        <Button className="group/history" data-testid={`${kind}-open-history`} onClick={() => revealRunHistory(kind)} size="sm" variant="link-gray">
          {copy.runs.openHistory}
          <AppIcon name="arrowRight" className="size-3.5 transition-transform duration-150 ease-out group-hover/history:translate-x-0.5 motion-reduce:transition-none" />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The stage footer: the next step stays visible even while locked, with the
 * reason and the action that unlocks it. `emphasis` keeps one primary action
 * per page (secondary while the stage has unapplied changes).
 */
export function StageNextAction({ href, label, disabled, testId, blocker, stageBlocker, reason, emphasis = "primary" }: {
  href: string;
  label: string;
  disabled: boolean;
  testId: string;
  /** Availability of the next stage; when blocked its message and CTA explain why. */
  blocker?: PipelineAvailability | null;
  /** This stage's own blocker, already shown above; the footer does not repeat the same words on screen. */
  stageBlocker?: PipelineAvailability | null;
  /** Fallback explanation when the next stage is locked for a stage-local reason. */
  reason: string;
  emphasis?: "primary" | "secondary";
}) {
  const pathname = usePathname();
  const reasonId = `${testId}-reason`;
  // Legacy names on purpose: `data-variant` echoes them and the emphasis contract is asserted on it.
  const variant = emphasis === "primary" ? "default" : "outline";
  // A blocker that points back at this page restates the stage's own job; the
  // stage reason says it better. Blockers elsewhere (or without a page) win.
  const showBlocker = hasVisibleBlocker(blocker) && (!blocker.href || blocker.href !== pathname);
  // The same sentence already explains the stage above: keep it as the button's description only.
  const repeatsStage = showBlocker && hasVisibleBlocker(stageBlocker) && stageBlocker.message === blocker?.message;
  const arrow = <AppIcon name="arrowRight" className="size-4 transition-transform duration-150 ease-out group-hover/button:translate-x-0.5 motion-reduce:transition-none" />;
  return (
    <footer className="mt-12 flex flex-wrap items-center justify-end gap-x-6 gap-y-3 border-t border-secondary pt-6" data-testid={`${testId}-footer`}>
      {disabled ? (repeatsStage
        ? <p className="sr-only" id={reasonId}>{blocker?.message}</p>
        : showBlocker
          ? <StageBlocker blocker={blocker} className="min-w-0 flex-1 justify-end text-right" id={reasonId} />
          : <p className="min-w-0 flex-1 text-right text-sm text-tertiary" id={reasonId}>{reason}</p>) : null}
      {disabled ? (
        <Button aria-describedby={reasonId} data-testid={testId} disabled size="lg" variant={variant}>{label}{arrow}</Button>
      ) : (
        <Button asChild data-testid={testId} size="lg" variant={variant}>
          <Link href={href}>{label}{arrow}</Link>
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
    <Notice
      action={(
        <div className="flex flex-wrap gap-2">
          {selectedId ? <Button onClick={() => void onBack(selectedId)} size="sm" variant="tertiary">{copy.runs.backToPipeline}</Button> : null}
          {canUse && completedCompatibleRun(inspected) ? <Button onClick={() => void onUse(inspectedId)} size="sm" variant="secondary">{copy.runs.useInPipeline}</Button> : null}
        </div>
      )}
      className="mt-6 items-center"
      data-testid={`${kind}-inspection-band`}
      icon="eye"
      tone="warning"
    >
      <span className="text-secondary">{text}</span>
    </Notice>
  );
}

function formatRunDate(locale: AppLocale, value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function readNumber(config: Record<string, unknown>, key: string) {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One quiet line that tells runs apart: what was configured and what came out. */
function runMeta(copy: AppCopy, locale: AppLocale, kind: RunKind, run: RunSummary) {
  const parts: Array<string | null> = [];
  if (kind === "chunk") {
    const size = readNumber(run.config, "chunkSizeTokens");
    const overlap = readNumber(run.config, "overlapTokens");
    parts.push(run.strategy ? copy.chunking.strategies[run.strategy as ChunkStrategy] ?? null : null);
    if (size !== null) parts.push(overlap !== null ? `${size} / ${overlap}` : String(size));
    if (run.chunkCount != null) parts.push(formatCount(locale, run.chunkCount, copy.units.chunk));
  } else if (kind === "embedding") {
    parts.push(run.model ?? null);
    if (run.dimensions != null) parts.push(formatCount(locale, run.dimensions, copy.units.dimension));
    if (run.embeddingCount != null) parts.push(formatCount(locale, run.embeddingCount, copy.units.vector));
  } else if (run.timing.durationMs != null) {
    parts.push(formatMs(locale, run.timing.durationMs));
  }
  parts.push(formatRunDate(locale, run.createdAt));
  return parts.filter(Boolean).join(" · ");
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
    <section className="mt-10 scroll-mt-6" data-testid={historyTestId[kind]} id={historyTestId[kind]}>
      <Disclosure contentClassName="divide-y divide-secondary p-0" meta={ordered.length} title={copy.runs.history[kind]}>
        {ordered.map((run) => {
          const usable = completedCompatibleRun(run);
          const isSelected = run.id === selectedId;
          const isViewed = run.id === viewedId;
          const meta = runMeta(copy, preferences.locale, kind, run);
          const runError = describeApiError(copy, run.error, runFailedCopy[kind](copy));
          // The "can't be used" badge says it in words; the raw reason of a completed run stays under
          // Technical details. Failed and in-flight runs are "not completed", which their badge says.
          const incompatibleReason = run.status === "completed" && !run.isCompatible && run.compatibilityReason ? run.compatibilityReason : null;
          const problem = run.status === "queued" || run.status === "running"
            ? <StatusBadge status="processing">{copy.runs.running}</StatusBadge>
            : run.status === "failed"
              ? <StatusBadge status="error">{copy.runs.failed}</StatusBadge>
              : !run.isCompatible
                ? <StatusBadge status="stale">{copy.runs.incompatible}</StatusBadge>
                : null;
          return (
            <div className={cn("flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between", isViewed && "bg-secondary")} data-testid={`${historyTestId[kind]}-row`} key={run.id}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-primary tabular-nums">{runName(copy, kind, run.runNumber)}</span>
                  {isSelected ? <Badge color="brand">{copy.runs.inUse}</Badge> : null}
                  {!isSelected && isViewed ? <Badge color="warning">{copy.runs.inspecting}</Badge> : null}
                  {!isSelected && run.id === defaultId ? <Badge color="gray">{copy.runs.documentDefault}</Badge> : null}
                  {run.historicalLineage ? <StatusBadge status="stale">{copy.runs.historical}</StatusBadge> : null}
                  {problem}
                </div>
                {meta ? <p className="mt-1 text-sm text-tertiary tabular-nums">{meta}</p> : null}
                {/* The badge carries the colour; the sentence names the cause. One Technical details per
                    row holds the run ID and the raw code/message, so the code is never shown twice. */}
                {runError ? <p className="mt-1 text-sm text-tertiary" data-testid="run-history-error">{runError.message}</p> : null}
                <TechnicalDetails className="mt-1.5" summaryClassName="text-xs">
                  <dl className="grid gap-1 text-xs text-tertiary">
                    {/* Parse rows already show the duration in their meta line. */}
                    {kind !== "parse" && run.timing.durationMs != null ? <div className="flex gap-2"><dt>{copy.runs.duration}</dt><dd className="text-secondary tabular-nums">{formatMs(preferences.locale, run.timing.durationMs)}</dd></div> : null}
                    <div className="flex min-w-0 gap-2"><dt className="shrink-0">{copy.runs.runId}</dt><dd className="min-w-0 font-mono text-secondary wrap-anywhere">{run.id}</dd></div>
                    {runError?.technical || incompatibleReason ? <div className="flex min-w-0 gap-2"><dt className="shrink-0">{copy.common.errorCode}</dt><dd className="min-w-0 font-mono text-secondary wrap-anywhere">{runError?.technical?.code ?? incompatibleReason}</dd></div> : null}
                    {runError?.technical?.message ? <div className="flex min-w-0 gap-2"><dt className="shrink-0">{copy.common.errorMessage}</dt><dd className="min-w-0 text-secondary break-words">{runError.technical.message}</dd></div> : null}
                  </dl>
                </TechnicalDetails>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                {usable && !isViewed ? <Button onClick={() => void onInspect(run.id)} size="sm" variant="secondary">{hasPipeline ? copy.runs.inspect : copy.runs.select}</Button> : null}
                {onUse && hasPipeline && usable && isViewed && !isSelected ? <Button onClick={() => void onUse(run.id)} size="sm" variant="secondary">{copy.runs.useInPipeline}</Button> : null}
              </div>
            </div>
          );
        })}
      </Disclosure>
    </section>
  );
}
