"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Disclosure, HowItWorks, TechnicalDetails } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Metric, MetricGroup, MetricValue } from "@/components/ui/metric";
import { Notice, type NoticeTone } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton, SkeletonBlock } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { InfoTip } from "@/components/ui/info-tip";
import { IconSwap, SuccessCheck, ThinkingText, TransitionPanel, TransitionText } from "@/components/ui/transitions";
import { useSlidingIndicator } from "@/components/ui/use-sliding-indicator";
import { getPipelineAvailability, type PipelineAvailability } from "@/lib/blockers";
import { type AppCopy, type AppLocale, interpolate, runName, UI_COPY } from "@/lib/copy";
import type { DocumentParseResponse } from "@/lib/document-parse-types";
import { formatCount, formatMs, formatNumber, formatScore } from "@/lib/format";
import type {
  ExperimentRun,
  ExperimentSummary,
  ExperimentTargetStage,
  GenerationOutcome,
  RetrievalMode,
  RetrievalScoreSemantics,
  StageReuseMetadata,
  ValidatedCitation,
} from "@/lib/rag-api-types";
import { sampleForHash } from "@/lib/sample-documents";
import { clearQuestionTransition } from "@/lib/transitions";
import { cn } from "@/lib/utils";

type PlaygroundStage = "retrieval" | "reranking" | "context" | "generation";
type RetrievalCopy = AppCopy["retrieval"];
type StageResults = ExperimentRun["stageResults"];
type GenerationResult = NonNullable<StageResults["generation"]>;
type SourceContext = { documentId: string | null; parseResult: DocumentParseResponse | null };
type StageTone = "done" | "skipped" | "running" | "failed" | "waiting";
type StageStatus = { label: string; tone: StageTone };

const STAGES = ["retrieval", "reranking", "context", "generation"] as const;
const MODES = ["dense", "hybrid", "keyword"] as const;
const TOP_K_OPTIONS = ["3", "4", "5", "6", "7", "8", "9", "10"];
const STAGE_ICONS: Record<PlaygroundStage, SemanticIconName> = { retrieval: "retrieve", reranking: "rerank", context: "context", generation: "generate" };
const DEFAULT_TOP_K = "5";
const DEFAULT_MODE: RetrievalMode = "hybrid";
const DEFAULT_CANDIDATE_COUNT = 10;
const DEFAULT_TOKEN_BUDGET = 3000;
const DEFAULT_TEMPERATURE = 0.1;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function experimentRetrievalMode(config: Record<string, unknown>) {
  const mode = objectValue(config.retrieval).mode;
  if (typeof mode === "string") return mode;
  return typeof config.retrievalMode === "string" ? config.retrievalMode : typeof config.mode === "string" ? config.mode : "—";
}

function modeLabel(mode: string, copy: RetrievalCopy) {
  return mode in copy.modes ? copy.modes[mode as RetrievalMode] : mode;
}

function lastAvailableStage(run: ExperimentRun): PlaygroundStage {
  if (run.stageResults.generation) return "generation";
  if (run.stageResults.context) return "context";
  if (run.stageResults.reranking?.executed) return "reranking";
  return "retrieval";
}

function runDate(run: { createdAt?: string | null; timing: { startedAt: string | null } }, locale: AppLocale, style: "medium" | "short") {
  const value = run.createdAt ?? run.timing.startedAt;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = style === "short" ? { day: "numeric", month: "short" } : { dateStyle: "medium" };
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", options).format(date);
}

function isExperimentDetail(run: ExperimentRun | ExperimentSummary): run is ExperimentRun {
  return "stageResults" in run;
}

function isInProgress(run: { status: string }) {
  return run.status === "queued" || run.status === "running";
}

/** Older payloads have no outcome; an empty abstaining answer is the insufficient-context case. */
function generationOutcome(generation: GenerationResult): GenerationOutcome {
  if (generation.outcome) return generation.outcome;
  return generation.insufficientContext && !generation.answer.trim() ? "insufficient_context" : "answered";
}

/** The score label follows the backend's declared semantics, falling back to the run's retrieval mode. */
function scoreLabelFor(semantics: RetrievalScoreSemantics | null | undefined, mode: string, copy: RetrievalCopy) {
  if (semantics === "cosine_similarity") return copy.scoreLabels.cosine;
  if (semantics === "postgres_ts_rank") return copy.scoreLabels.keyword;
  if (semantics === "relative_min_max_fusion_within_candidate_pool") return copy.scoreLabels.fusion;
  return mode === "dense" ? copy.scoreLabels.cosine : mode === "keyword" ? copy.scoreLabels.keyword : copy.scoreLabels.fusion;
}

function excerpt(text: string, max = 80) {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** The chunk a citation names, looked up in this run's own stage outputs (never another run's). */
function citedChunk(chunkId: string, results: StageResults) {
  const pools = [results.retrieval?.results ?? [], results.retrieval?.candidates ?? [], results.reranking?.candidates ?? [], results.reranking?.inputCandidates ?? []];
  let title: string | null = null;
  let text: string | null = null;
  for (const pool of pools) {
    const match = pool.find((item) => item.chunkId === chunkId);
    if (!match) continue;
    if (!title && match.headingPath.length) title = match.headingPath.join(" › ");
    if (!text && match.text.trim()) text = match.text.trim();
  }
  const contextText = results.context?.candidates.find((item) => item.chunkId === chunkId)?.text.trim();
  text ??= contextText || null;
  return { title: title ?? (text ? excerpt(text) : null), text };
}

function pageRef(pageNumbers: number[], units: AppCopy["units"]) {
  return pageNumbers.length ? `${units.pageShort} ${pageNumbers.join(", ")}` : null;
}

type DraftSettings = { question: string; topK: string; mode: RetrievalMode; rerankerEnabled: boolean; candidateCount: number; tokenBudget: number; temperature: number; targetStage: ExperimentTargetStage };

function savedRunMatchesDraft(run: ExperimentRun, draft: DraftSettings) {
  const retrieval = objectValue(run.config.retrieval);
  const reranking = objectValue(run.config.reranking);
  const context = objectValue(run.config.context);
  const generation = objectValue(run.config.generation);
  return run.query === draft.question.trim()
    && run.targetStage === draft.targetStage
    && String(retrieval.mode ?? "") === draft.mode
    && numberValue(retrieval.topK, -1) === Number(draft.topK)
    && Boolean(reranking.enabled) === draft.rerankerEnabled
    // The candidate count only exists while the reranker is on.
    && (!draft.rerankerEnabled || numberValue(reranking.candidateCount, -1) === draft.candidateCount)
    && numberValue(context.tokenBudget, -1) === draft.tokenBudget
    && numberValue(generation.temperature, -1) === draft.temperature;
}

function stageStatusFor(run: ExperimentRun, stage: PlaygroundStage, copy: RetrievalCopy, locale: AppLocale): StageStatus {
  const result = run.stageResults[stage];
  if (result) {
    if (stage === "reranking" && "executed" in result && !result.executed) return { label: copy.stageStatus.skipped, tone: "skipped" };
    return { label: typeof result.durationMs === "number" ? formatMs(locale, result.durationMs) : "", tone: "done" };
  }
  const completedCount = STAGES.filter((item) => Boolean(run.stageResults[item])).length;
  const index = STAGES.indexOf(stage);
  if (run.status === "queued") return { label: index === 0 ? copy.stageStatus.queued : copy.stageStatus.waiting, tone: "waiting" };
  if (run.status === "running" && index === completedCount) return { label: copy.stageStatus.running, tone: "running" };
  if (run.status === "failed" && index === completedCount) return { label: copy.stageStatus.failed, tone: "failed" };
  if (stage === "reranking" && !objectValue(run.config.reranking).enabled && run.status === "completed") return { label: copy.stageStatus.skipped, tone: "skipped" };
  return { label: copy.stageStatus.waiting, tone: "waiting" };
}

const subscribeNever = () => () => undefined;

/** ⌘ on Apple keyboards, Ctrl elsewhere; the server and first paint assume Ctrl. */
function useIsApplePlatform() {
  return useSyncExternalStore(subscribeNever, () => /Mac|iPhone|iPad|iPod/.test(navigator.platform), () => false);
}

/* ------------------------------------------------------------------ */
/* Stage rail                                                          */

const MARKER_TONES: Record<StageTone, string> = {
  done: "bg-tertiary text-fg-secondary",
  skipped: "bg-primary text-fg-quaternary ring-1 ring-secondary ring-inset",
  running: "bg-brand-primary ring-1 ring-utility-brand-200 ring-inset",
  failed: "bg-error-primary text-fg-error-primary ring-1 ring-utility-error-200 ring-inset",
  waiting: "bg-primary ring-1 ring-primary ring-inset",
};

const STATUS_TEXT: Record<StageTone, string> = {
  done: "text-quaternary",
  skipped: "text-quaternary",
  running: "text-brand-secondary",
  failed: "text-error-primary",
  waiting: "text-quaternary",
};

function StageMarker({ tone }: { tone: StageTone }) {
  return (
    <span aria-hidden="true" className={cn("relative grid size-6 shrink-0 place-items-center rounded-full transition-colors duration-200", MARKER_TONES[tone])}>
      {tone === "done" ? <SuccessCheck className="size-3.5" />
        : tone === "running" ? <Spinner size="xs" />
          : tone === "failed" ? <AppIcon className="size-3.5" name="close" strokeWidth={2} />
            : tone === "skipped" ? <AppIcon className="size-3.5" name="minus" strokeWidth={2} />
              : null}
    </span>
  );
}

/** Vertical connector between two rail markers (desktop rail only). */
function RailConnector({ done }: { done: boolean }) {
  return <span aria-hidden="true" className={cn("absolute top-8 -bottom-2 left-5.5 z-20 hidden w-px transition-colors duration-300 lg:block", done ? "bg-fg-quaternary" : "bg-border-secondary")} />;
}

function ExperimentStageTrace({ activeStage, copy, locale, onSelect, run }: { activeStage: PlaygroundStage; copy: RetrievalCopy; locale: AppLocale; onSelect: (stage: PlaygroundStage) => void; run: ExperimentRun }) {
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLOListElement>("[data-selected]");
  return (
    // Mobile: a 2×2 grid keeps every stage visible (no clipped horizontal strip); desktop: a vertical rail.
    <ol aria-label={copy.stagesLabel} className="relative grid grid-cols-2 gap-1 lg:flex lg:flex-col lg:gap-0" data-testid="experiment-stage-trace" ref={containerRef}>
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 rounded-lg bg-primary opacity-0 shadow-xs ring-1 ring-secondary transition-[translate,width,height,opacity] duration-(--tabs-dur) ease-(--tabs-ease) dark:bg-tertiary dark:ring-secondary_alt" ref={indicatorRef} />
      {typeof run.queueDurationMs === "number" ? (
        <li className="relative col-span-2 flex min-h-10 items-center gap-3 px-2.5 py-2 text-sm text-tertiary" data-testid="experiment-stage-queue" title={copy.queueHint}>
          <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center"><span className="size-3 rounded-full border border-dashed border-fg-quaternary" /></span>
          <span className="min-w-0 flex-1 truncate">{copy.queue}</span>
          <span className="shrink-0 text-xs text-quaternary tabular-nums">{formatMs(locale, run.queueDurationMs)}</span>
          <span className="sr-only">{copy.queueHint}</span>
          <RailConnector done />
        </li>
      ) : null}
      {STAGES.map((stage, index) => {
        const status = stageStatusFor(run, stage, copy, locale);
        const active = activeStage === stage;
        return (
          <li className="relative min-w-0" key={stage}>
            {index < STAGES.length - 1 ? <RailConnector done={status.tone === "done" || status.tone === "skipped"} /> : null}
            <button
              aria-pressed={active}
              className={cn(
                "relative z-10 flex min-h-10 w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-150",
                !active && "hover:bg-tertiary",
              )}
              data-selected={active || undefined}
              onClick={() => onSelect(stage)}
              type="button"
            >
              <StageMarker tone={status.tone} />
              {/* Phones stack the status under the name so neither is clipped in the 2×2 grid. */}
              <span className="flex min-w-0 flex-1 flex-col lg:flex-row lg:items-center lg:gap-3">
                <span className={cn("min-w-0 truncate text-sm lg:flex-1", active ? "font-semibold text-primary" : "font-medium text-secondary")}>{copy.stages[stage]}</span>
                {" "}
                {status.label ? <span className={cn("shrink-0 truncate text-xs tabular-nums", STATUS_TEXT[status.tone])}>{status.label}</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Stage views                                                         */

/** Reuse is the exception worth showing; executing a stage is the default and stays in Details. */
function StageReuseNote({ copy, reuse, stage }: { copy: RetrievalCopy; reuse?: StageReuseMetadata | null; stage: string }) {
  if (!reuse?.reused) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-tertiary" data-testid={`stage-reuse-${stage}`}>
      <Badge icon="history" title={copy.reusedHint}>{copy.reused}</Badge>
      {reuse.sourceExperimentId ? <TechnicalDetails><span className="font-mono text-xs break-all">{reuse.sourceExperimentId}</span></TechnicalDetails> : null}
    </div>
  );
}

/** The stage panel leads with its data: a title and, on the right, the numbers that frame the list. */
function StageHeading({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <h2 className="text-lg font-semibold text-primary">{title}</h2>
      {meta ? <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-tertiary tabular-nums">{meta}</div> : null}
    </div>
  );
}

function RankBadge({ children }: { children: ReactNode }) {
  return <span className="grid size-6 shrink-0 place-items-center rounded-md bg-tertiary text-xs font-semibold text-secondary tabular-nums">{children}</span>;
}

function StageEmpty({ children }: { children: ReactNode }) {
  return <p className="mt-4 flex items-center gap-2 border-t border-secondary pt-5 text-sm text-tertiary"><AppIcon className="size-4 shrink-0 text-fg-quaternary" name="info" />{children}</p>;
}

/** A thin, ranked magnitude bar (BarList idea): the longest bar is the best score in this list. */
function ScoreBar({ value, max, index }: { value: number | null; max: number; index: number }) {
  const width = typeof value === "number" && value > 0 && max > 0 ? Math.max((value / max) * 100, 2) : 0;
  return (
    <span aria-hidden="true" className="relative block h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-tertiary">
      <span
        className="absolute inset-y-0 left-0 animate-in rounded-full bg-fg-quaternary transition-[width,background-color] duration-500 ease-out fade-in slide-in-from-left-2 fill-mode-backwards group-hover/candidate:bg-fg-brand-primary"
        style={{ width: `${width}%`, animationDelay: `${Math.min(index, 8) * 50}ms` }}
      />
    </span>
  );
}

function RetrievalStageView({ copy, locale, run, source }: { copy: RetrievalCopy; locale: AppLocale; run: ExperimentRun; source: SourceContext }) {
  const units = UI_COPY[locale].units;
  const stage = run.stageResults.retrieval;
  // The top-K list is what reached the next stage; older payloads only carry `candidates`.
  const items = stage?.results ?? stage?.candidates ?? [];
  const maxScore = Math.max(0, ...items.map((item) => (typeof item.score === "number" ? item.score : 0)));
  const scoreLabel = scoreLabelFor(stage?.scoreSemantics, experimentRetrievalMode(run.config), copy);
  const reranking = run.stageResults.reranking;
  const rerankerInput = reranking?.executed ? reranking.inputCandidates?.length ?? null : null;
  return (
    <>
      <StageHeading
        meta={items.length ? (
          <>
            {/* The score's meaning is named once for the list; each row repeats it for screen readers only. */}
            <span className="inline-flex items-center gap-1" data-testid="playground-score-legend">{scoreLabel}<InfoTip label={copy.scoreInfo} title={copy.scoreHint} /></span>
            {rerankerInput !== null ? <span data-testid="playground-reranker-input">{interpolate(copy.rerankerInput, { count: formatCount(locale, rerankerInput, units.candidate) })}</span> : null}
          </>
        ) : null}
        title={copy.retrievedTitle}
      />
      <StageReuseNote copy={copy} reuse={stage?.reuse} stage="retrieval" />
      {items.length ? (
        <>
          <p className="sr-only">{copy.scoreHint}</p>
          <ol aria-label={copy.retrievedTitle} className="mt-4 divide-y divide-secondary border-t border-secondary">
            {items.map((candidate, index) => {
              const heading = candidate.headingPath.join(" › ") || copy.sourceDocument;
              const pages = pageRef(candidate.pageNumbers, units);
              return (
                <li className="group/candidate flex min-w-0 items-start gap-4 py-4" key={candidate.chunkId}>
                  <RankBadge>{candidate.rank}</RankBadge>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 pt-0.5 text-sm font-semibold break-words text-primary">{heading}</p>
                      <SourceInspector documentId={source.documentId} headingPath={candidate.headingPath} pageNumbers={candidate.pageNumbers} parseResult={source.parseResult} sourceElementIds={candidate.sourceElementIds} triggerAriaLabel={interpolate(copy.inspectSource, { label: heading })} triggerLabel={copy.viewSource} variant="icon" />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <ScoreBar index={index} max={maxScore} value={candidate.score} />
                      <p className="max-w-full shrink-0 text-xs text-tertiary tabular-nums">
                        <span data-testid="candidate-score" title={copy.scoreHint}><span className="sr-only">{scoreLabel} </span><span className="font-semibold text-secondary">{formatScore(candidate.score)}</span></span>
                        {pages ? <span className="text-quaternary"> · {pages}</span> : null}
                      </p>
                    </div>
                    {/* Retrieved document text is untrusted data: rendered as plain text only. */}
                    <p className="mt-2 line-clamp-2 text-sm leading-6 break-words text-tertiary">{candidate.text}</p>
                    <TechnicalDetails className="mt-2">
                      <p className="text-xs font-medium text-tertiary">{copy.scoreBreakdown}</p>
                      <dl className="mt-2 grid max-w-md grid-cols-3 gap-3 text-xs">
                        {([[copy.modes.dense, candidate.denseScore, candidate.denseRank], [copy.modes.keyword, candidate.keywordScore, candidate.keywordRank], ["Fusion", candidate.fusionScore, undefined]] as const).map(([label, score, rank]) => (
                          <div className="min-w-0" key={label}>
                            <dt className="text-quaternary">{label}</dt>
                            <dd className="mt-0.5 font-medium text-secondary tabular-nums">{formatScore(score, 4)}{rank !== undefined ? <span className="ml-1 font-normal text-quaternary">#{rank ?? "—"}</span> : null}</dd>
                          </div>
                        ))}
                      </dl>
                      <dl className="mt-3 text-xs">
                        <dt className="text-quaternary">{copy.sourceElements}</dt>
                        <dd className="mt-0.5 font-mono break-all text-tertiary">{candidate.sourceElementIds.join(", ") || "—"}</dd>
                      </dl>
                    </TechnicalDetails>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : <StageEmpty>{copy.noCandidates}</StageEmpty>}
    </>
  );
}

function RankMove({ from, to }: { from: number; to: number }) {
  const delta = from - to;
  return (
    <span aria-hidden="true" className="inline-flex h-5 items-center gap-0.5 rounded-md bg-tertiary px-1.5 text-xs font-medium text-secondary tabular-nums">
      <AppIcon className="size-3" name={delta > 0 ? "trendUp" : delta < 0 ? "trendDown" : "minus"} strokeWidth={2} />
      {delta === 0 ? null : Math.abs(delta)}
    </span>
  );
}

function RerankingStageView({ copy, locale, run, source }: { copy: RetrievalCopy; locale: AppLocale; run: ExperimentRun; source: SourceContext }) {
  const units = UI_COPY[locale].units;
  const stage = run.stageResults.reranking;
  const executed = Boolean(stage?.executed);
  const inputCount = stage?.inputCandidates?.length ?? stage?.candidates.length ?? 0;
  const rerankerEnabled = Boolean(objectValue(run.config.reranking).enabled);
  return (
    <>
      <StageHeading meta={executed ? interpolate(copy.rerankingDescription, { count: formatCount(locale, inputCount, units.candidate) }) : null} title={copy.stages.reranking} />
      <StageReuseNote copy={copy} reuse={stage?.reuse} stage="reranking" />
      {executed && stage?.candidates.length ? (
        <ol aria-label={copy.stages.reranking} className="mt-4 divide-y divide-secondary border-t border-secondary">
          {stage.candidates.map((candidate) => {
            const position = candidate.rerankRank ?? candidate.rank;
            const heading = candidate.headingPath.join(" › ") || copy.sourceDocument;
            return (
              <li className="flex min-w-0 items-start gap-4 py-4" key={candidate.chunkId}>
                {/* The badge is the new position; the row only adds where it came from. */}
                <RankBadge><span className="sr-only">{copy.rerankedPosition} </span>{position}</RankBadge>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 pt-0.5 text-sm font-semibold break-words text-primary">{heading}</p>
                    <SourceInspector documentId={source.documentId} headingPath={candidate.headingPath} pageNumbers={candidate.pageNumbers} parseResult={source.parseResult} sourceElementIds={candidate.sourceElementIds} triggerAriaLabel={interpolate(copy.inspectSource, { label: heading })} triggerLabel={copy.viewSource} variant="icon" />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <RankMove from={candidate.originalRank} to={position} />
                    <span className="text-xs text-tertiary tabular-nums">{copy.originalRank} {candidate.originalRank}</span>
                  </div>
                  {candidate.rankedBy === "retrieval_fallback" || candidate.rerankInputTruncated ? (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-warning-primary">
                      <AppIcon className="mt-0.5 size-3.5 shrink-0" name="warningTriangle" />
                      {[candidate.rankedBy === "retrieval_fallback" ? copy.rankedByFallback : null, candidate.rerankInputTruncated ? copy.inputTruncated : null].filter(Boolean).join(" ")}
                    </p>
                  ) : null}
                  {/* Retrieved document text is untrusted data: rendered as plain text only. */}
                  <p className="mt-2 line-clamp-2 text-sm leading-6 break-words text-tertiary">{candidate.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : <StageEmpty>{executed ? copy.noCandidates : rerankerEnabled ? copy.noStageOutput : copy.rerankSkipped}</StageEmpty>}
    </>
  );
}

type ContextStage = NonNullable<StageResults["context"]>;

/**
 * The context window as one bar: selected chunks fill it in order, the rest of the budget stays empty.
 * The filled length is the measured token count; chunks split it by their own token counts.
 */
function ContextWindowBar({ copy, locale, stage }: { copy: RetrievalCopy; locale: AppLocale; stage: ContextStage }) {
  const units = UI_COPY[locale].units;
  const capacity = Math.max(stage.tokenBudget, stage.tokenCount, 1);
  const usedShare = Math.min(1, Math.max(0, stage.tokenCount) / capacity);
  const selected = stage.candidates.filter((candidate) => candidate.selected && candidate.tokenCount > 0);
  const selectedTokens = selected.reduce((sum, candidate) => sum + candidate.tokenCount, 0);
  const segments = selectedTokens > 0
    ? selected.map((candidate) => ({ key: candidate.chunkId, width: (candidate.tokenCount / selectedTokens) * usedShare * 100, title: formatCount(locale, candidate.tokenCount, units.token) }))
    : usedShare > 0 ? [{ key: "used", width: usedShare * 100, title: formatCount(locale, stage.tokenCount, units.token) }] : [];
  const usage = interpolate(copy.tokenUsage, { used: formatNumber(locale, stage.tokenCount), budget: formatNumber(locale, stage.tokenBudget) });
  return (
    <div aria-label={`${copy.finalContext}: ${usage}`} className="mt-3 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-tertiary" role="img">
      {segments.map((segment, index) => (
        <span
          className="h-full shrink-0 animate-in bg-fg-quaternary transition-colors duration-150 fade-in slide-in-from-left-2 fill-mode-backwards first:rounded-l-full hover:bg-fg-brand-primary"
          key={segment.key}
          style={{ width: `${segment.width}%`, animationDelay: `${Math.min(index, 8) * 60}ms` }}
          title={segment.title}
        />
      ))}
    </div>
  );
}

function ContextStageView({ copy, locale, run }: { copy: RetrievalCopy; locale: AppLocale; run: ExperimentRun }) {
  const units = UI_COPY[locale].units;
  const stage = run.stageResults.context;
  const reasonLabel = (reason: string) => reason in copy.reasons ? copy.reasons[reason as keyof RetrievalCopy["reasons"]] : null;
  return (
    <>
      <StageHeading meta={stage ? interpolate(copy.tokenUsage, { used: formatNumber(locale, stage.tokenCount), budget: formatNumber(locale, stage.tokenBudget) }) : null} title={copy.contextTitle} />
      <StageReuseNote copy={copy} reuse={stage?.reuse} stage="context" />
      {stage ? (
        <>
          <section aria-label={copy.finalContext} className="mt-1">
            <ContextWindowBar copy={copy} locale={locale} stage={stage} />
            <Disclosure className="mt-3" title={copy.showContext} variant="inline">
              <pre aria-label={copy.finalContext} className="technical-scrollbar max-h-90 overflow-auto rounded-lg bg-secondary p-4 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-secondary" role="region" tabIndex={0}>{stage.finalContext || copy.noStageOutput}</pre>
            </Disclosure>
          </section>
          {stage.candidates.length ? (
            <ol aria-label={copy.contextTitle} className="mt-4 divide-y divide-secondary border-t border-secondary">
              {stage.candidates.map((candidate, index) => {
                const reason = candidate.selected ? null : reasonLabel(candidate.reason);
                return (
                  <li className="flex min-w-0 items-start gap-4 py-4" key={`${candidate.chunkId}-${index}`}>
                    <RankBadge>{index + 1}</RankBadge>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {/* Selected is the norm (a check); only an exclusion is spelled out with its reason. */}
                        <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", candidate.selected ? "text-primary" : "text-tertiary")}>
                          <AppIcon className={cn("size-4", candidate.selected ? "text-fg-secondary" : "text-fg-quaternary")} name={candidate.selected ? "check" : "minus"} strokeWidth={2} />
                          {candidate.selected ? <span className="sr-only">{copy.selected}</span> : copy.excluded}
                          {reason ? <span className="font-normal text-tertiary"> · {reason}</span> : null}
                        </span>
                        <span className="text-xs text-quaternary tabular-nums">{formatCount(locale, candidate.tokenCount, units.token)}</span>
                      </div>
                      {/* Retrieved document text is untrusted data: rendered as plain text only. */}
                      <p className={cn("mt-1.5 line-clamp-2 text-sm leading-6 break-words", candidate.selected ? "text-tertiary" : "text-quaternary")}>{candidate.text}</p>
                      <TechnicalDetails className="mt-2">
                        <dl className="grid gap-2 text-xs">
                          <div><dt className="text-quaternary">{copy.decision}</dt><dd className="mt-0.5 font-mono text-tertiary">{candidate.reason || "—"}</dd></div>
                          <div><dt className="text-quaternary">{copy.sourceElements}</dt><dd className="mt-0.5 font-mono break-all text-tertiary">{candidate.sourceElementIds.join(", ") || "—"}</dd></div>
                        </dl>
                      </TechnicalDetails>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </>
      ) : <StageEmpty>{copy.noStageOutput}</StageEmpty>}
    </>
  );
}

function CitationPreview({ citation, copy, locale, results }: { citation: ValidatedCitation; copy: RetrievalCopy; locale: AppLocale; results: StageResults }) {
  const chunk = citedChunk(citation.chunkId, results);
  const pages = pageRef(citation.pageNumbers, UI_COPY[locale].units);
  const text = citation.quote?.trim() || chunk.text;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-semibold text-primary"><span className="mr-1.5 text-quaternary tabular-nums">{citation.citationId}</span>{chunk.title ?? copy.sourceDocument}</p>
        {pages ? <span className="shrink-0 pt-0.5 text-xs text-quaternary tabular-nums">{pages}</span> : null}
      </div>
      {/* Retrieved document text is untrusted data: rendered as plain text only. */}
      {text ? <p className="line-clamp-5 text-sm leading-6 break-words text-secondary">{text}</p> : null}
      <div className="flex items-center justify-between gap-3 border-t border-secondary pt-3">
        <StatusBadge status={citation.valid ? "success" : "warning"}>{citation.valid ? copy.citationValid : copy.citationCheck}</StatusBadge>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-tertiary">{copy.inspector.open}<AppIcon className="size-3.5" name="arrowRight" /></span>
      </div>
    </div>
  );
}

function CitationChip({ citation, copy, locale, results, source }: { citation: ValidatedCitation; copy: RetrievalCopy; locale: AppLocale; results: StageResults; source: SourceContext }) {
  return (
    <SourceInspector
      documentId={source.documentId}
      invalid={!citation.valid}
      pageNumbers={citation.pageNumbers}
      parseResult={source.parseResult}
      preview={<CitationPreview citation={citation} copy={copy} locale={locale} results={results} />}
      sourceElementIds={citation.sourceElementIds}
      triggerAriaLabel={interpolate(copy.inspectSource, { label: citation.citationId })}
      triggerLabel={citation.citationId}
      variant="chip"
    />
  );
}

function AnswerStageView({ copy, locale, run, source }: { copy: RetrievalCopy; locale: AppLocale; run: ExperimentRun; source: SourceContext }) {
  const units = UI_COPY[locale].units;
  const generation = run.stageResults.generation;
  if (!generation) {
    return (
      <>
        <StageHeading title={copy.answerTitle} />
        <StageEmpty>{copy.noAnswer}</StageEmpty>
      </>
    );
  }
  const outcome = generationOutcome(generation);
  const citationsById = new Map(generation.citations.map((citation) => [citation.citationId, citation]));
  const segments = generation.segments?.length ? generation.segments : null;
  const rejectedToken = generation.groundingFailureDetail?.token;
  const answerText = "max-w-prose text-md leading-7 break-words text-primary";
  return (
    <>
      <StageHeading title={copy.answerTitle} />
      <StageReuseNote copy={copy} reuse={generation.reuse} stage="generation" />
      <div className="mt-4" data-testid="playground-answer">
        {outcome === "grounding_rejected" ? (
          <Notice data-testid="playground-grounding-rejected" role="status" title={rejectedToken ? interpolate(copy.groundingRejected, { token: rejectedToken }) : copy.groundingRejectedGeneric} tone="warning">
            {copy.groundingRejectedHint}
          </Notice>
        ) : outcome === "insufficient_context" ? (
          <Notice data-testid="playground-insufficient-context" icon="info" role="status" title={copy.insufficientTitle} tone="neutral" />
        ) : segments ? (
          // One paragraph; each validated segment ends with its clickable citation markers.
          <p className={answerText} data-testid="playground-answer-text">
            {segments.map((segment, index) => (
              <span key={index}>
                {index ? " " : null}{segment.text}
                {segment.citationIds.map((citationId) => {
                  const citation = citationsById.get(citationId);
                  return citation
                    ? <CitationChip citation={citation} copy={copy} key={citationId} locale={locale} results={run.stageResults} source={source} />
                    : <span className="mx-0.5 text-xs text-quaternary tabular-nums" key={citationId}>[{citationId}]</span>;
                })}
              </span>
            ))}
          </p>
        ) : generation.answer.trim()
          ? <p className={answerText} data-testid="playground-answer-text">{generation.answer}</p>
          : <p className="text-sm text-tertiary">{copy.noAnswer}</p>}
      </div>
      {generation.citations.length ? (
        <section aria-labelledby="playground-citations-title" className="mt-8" data-testid="playground-citations">
          {/* The validity caveat stays visible: a valid citation is not proof that the claim is supported. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="text-sm font-semibold text-primary" id="playground-citations-title">{copy.citations}</h3>
            <p className="flex items-start gap-1.5 text-xs text-tertiary"><AppIcon className="mt-px size-3.5 shrink-0 text-fg-quaternary" name="info" />{copy.citationCaveat}</p>
          </div>
          <ul className="mt-2 divide-y divide-secondary border-y border-secondary">
            {generation.citations.map((citation) => {
              const pages = pageRef(citation.pageNumbers, units);
              const chunk = citedChunk(citation.chunkId, run.stageResults);
              return (
                <li className="flex min-w-0 items-center gap-3 py-2.5" key={citation.citationId}>
                  <CitationChip citation={citation} copy={copy} locale={locale} results={run.stageResults} source={source} />
                  <span className="min-w-0 flex-1 truncate text-sm text-secondary">{chunk.title ?? citation.quote ?? copy.sourceDocument}</span>
                  {pages ? <span className="shrink-0 text-xs text-quaternary tabular-nums">{pages}</span> : null}
                  <StatusBadge appearance="icon" status={citation.valid ? "success" : "warning"}>{citation.valid ? copy.citationValid : copy.citationCheck}</StatusBadge>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}

const stageTitles = (copy: RetrievalCopy): Record<PlaygroundStage, string> => ({
  retrieval: copy.retrievedTitle,
  reranking: copy.stages.reranking,
  context: copy.contextTitle,
  generation: copy.answerTitle,
});

/** A stage that has not produced output yet in a run that is still going: its shape, not an empty result. */
function StagePending({ copy, stage, status }: { copy: RetrievalCopy; stage: PlaygroundStage; status: StageStatus }) {
  return (
    <>
      <StageHeading title={stageTitles(copy)[stage]} />
      <div className="mt-4 border-t border-secondary pt-5" data-testid="playground-stage-pending">
        <p className={cn("flex items-center gap-2 text-sm font-medium", status.tone === "running" ? "text-brand-secondary" : "text-tertiary")}>
          {status.tone === "running" ? <Spinner size="xs" /> : <AppIcon className="size-4 text-fg-quaternary" name="queued" />}
          {status.label}
        </p>
        <div aria-hidden="true" className="mt-4 grid max-w-prose gap-2.5">
          <SkeletonBlock className="w-11/12" />
          <SkeletonBlock className="w-full" />
          <SkeletonBlock className="w-3/4" />
          {stage === "generation" ? null : <SkeletonBlock className="mt-4 w-5/6" />}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Surrounding states                                                  */

function ExperimentErrorSurface({ copy, error }: { copy: RetrievalCopy; error: { code?: string | null; message?: string | null } | null }) {
  if (error?.code === "run_poll_timeout") {
    return <Notice className="mt-6" data-testid="playground-tracking-paused" role="status" tone="warning">{copy.trackingPaused}</Notice>;
  }
  return (
    <section aria-live="assertive" className="mt-6 flex items-start gap-3 rounded-xl bg-error-primary px-4 py-4 ring-1 ring-utility-error-200 ring-inset" data-testid="playground-error" role="alert">
      <AppIcon className="mt-0.5 size-5 shrink-0 text-fg-error-primary" name="warning" />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-primary">{copy.errorTitle}</h2>
        <p className="mt-0.5 text-sm text-tertiary">{copy.errorBody}</p>
        {error?.code || error?.message ? (
          <TechnicalDetails className="mt-2">
            <dl className="grid gap-1.5 text-xs text-tertiary">
              <div><dt className="inline font-medium">{copy.errorCode}: </dt><dd className="inline font-mono">{error.code || "—"}</dd></div>
              <div><dt className="inline font-medium">{copy.errorMessage}: </dt><dd className="inline break-words">{error.message || "—"}</dd></div>
            </dl>
          </TechnicalDetails>
        ) : null}
      </div>
    </section>
  );
}

const BLOCKER_ICONS: Partial<Record<NonNullable<PipelineAvailability["code"]>, SemanticIconName>> = {
  missing_document: "document",
  missing_pipeline: "database",
  missing_parse: "parse",
  missing_chunk: "chunk",
  missing_embedding: "embed",
  invalid_config: "settings",
};

/**
 * Why the experiment cannot run, with the step that unblocks it. Missing prerequisites are calm
 * (an empty state when nothing is shown yet); an outage or an incompatible lineage is coloured.
 */
function PlaygroundBlocker({ availability, compact }: { availability: PipelineAvailability; compact: boolean }) {
  const pathname = usePathname();
  const showAction = Boolean(availability.href && availability.requiredAction && availability.href !== pathname);
  const action = showAction
    ? <Link className={buttonStyles({ variant: "secondary", size: "sm" })} href={availability.href!}>{availability.requiredAction}<AppIcon className="size-4" name="arrowRight" /></Link>
    : null;
  const tone: NoticeTone = availability.code === "backend_unavailable" ? "error" : availability.code === "incompatible_lineage" ? "warning" : "neutral";
  if (compact || tone !== "neutral") {
    return <Notice action={action} className="mt-6" data-code={availability.code ?? undefined} data-testid="playground-blocker" role="status" tone={tone}>{availability.message}</Notice>;
  }
  return (
    <EmptyState
      action={action}
      className="mt-10"
      data-code={availability.code ?? undefined}
      data-testid="playground-blocker"
      icon={(availability.code && BLOCKER_ICONS[availability.code]) || "lock"}
      role="status"
      title={availability.message}
      titleAs="p"
    />
  );
}

/** The four stages a run will walk through, as a quiet preview in the ready state. */
function StagePreview({ copy }: { copy: RetrievalCopy }) {
  return (
    <ol aria-hidden="true" className="flex flex-wrap items-center justify-center gap-1.5">
      {STAGES.map((stage, index) => (
        <li className="flex animate-in items-center gap-1.5 fade-in slide-in-from-bottom-1 duration-500 fill-mode-backwards" key={stage} style={{ animationDelay: `${150 + index * 90}ms` }}>
          {index ? <AppIcon className="size-4 text-fg-quaternary" name="chevronRight" /> : null}
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-primary px-2.5 text-sm font-medium text-secondary shadow-xs ring-1 ring-secondary ring-inset">
            <AppIcon className="size-3.5 text-fg-quaternary" name={STAGE_ICONS[stage]} />
            {copy.stages[stage]}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Run-level numbers; they roll in as the stages report. */
function RunSummary({ copy, locale, run }: { copy: RetrievalCopy; locale: AppLocale; run: ExperimentRun }) {
  const results = run.stageResults;
  const duration = run.timing.durationMs;
  const inSeconds = typeof duration === "number" && duration >= 1000;
  const retrieved = results.retrieval ? (results.retrieval.results ?? results.retrieval.candidates).length : null;
  const citations = results.generation?.citations ?? null;
  return (
    <div className="border-b border-secondary px-5 py-4 sm:px-6" data-testid="playground-run-summary">
      <MetricGroup>
        <Metric
          format={{ maximumFractionDigits: inSeconds ? 1 : 0 }}
          label={copy.duration}
          size="sm"
          suffix={inSeconds ? " s" : " ms"}
          value={typeof duration === "number" ? (inSeconds ? duration / 1000 : Math.round(duration)) : null}
        />
        <Metric label={copy.candidates} size="sm" value={retrieved} />
        <Metric label={copy.contextUsage} size="sm" suffix={results.context ? ` / ${formatNumber(locale, results.context.tokenBudget)}` : undefined} value={results.context?.tokenCount ?? null} />
        <Metric label={copy.validCitations} size="sm" suffix={citations ? ` / ${formatNumber(locale, citations.length)}` : undefined} value={citations ? citations.filter((citation) => citation.valid).length : null} />
      </MetricGroup>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-tertiary">{label}</dt><dd className="text-right font-medium text-primary tabular-nums">{children}</dd></div>;
}

function ExperimentDetails({ copy, locale, run }: { copy: RetrievalCopy; locale: AppLocale; run: ExperimentRun }) {
  const retrieval = objectValue(run.config.retrieval);
  const reranking = objectValue(run.config.reranking);
  const context = objectValue(run.config.context);
  const generation = objectValue(run.config.generation);
  const rerankerOn = Boolean(reranking.enabled);
  const results = run.stageResults;
  const outcome = results.generation ? generationOutcome(results.generation) : null;
  const outputResult = outcome === "grounding_rejected" ? copy.outcomes.rejected
    : outcome === "insufficient_context" ? copy.outcomes.insufficient
      : outcome === "answered" ? copy.outcomes.answered
        : results.context ? copy.outcomes.context
          : results.reranking?.executed ? copy.outcomes.reranked
            : copy.outcomes.retrieved;
  const timings = results.retrieval?.timings;
  return (
    <Disclosure className="mt-6" contentClassName="grid gap-x-10 gap-y-6 px-5 py-5 sm:grid-cols-2" data-testid="playground-details" title={copy.details}>
      <div className="grid content-start gap-6">
        <section>
          <h3 className="text-sm font-semibold text-primary">{copy.configuration}</h3>
          <dl className="mt-3 grid gap-2 text-sm">
            <DetailRow label={copy.mode}>{modeLabel(experimentRetrievalMode(run.config), copy)}</DetailRow>
            <DetailRow label={copy.topK}>{String(retrieval.topK ?? "—")}</DetailRow>
            <DetailRow label={copy.reranker}>{rerankerOn ? copy.on : copy.off}</DetailRow>
            {rerankerOn ? <DetailRow label={copy.candidateCount}>{String(reranking.candidateCount ?? "—")}</DetailRow> : null}
            <DetailRow label={copy.targetStage}>{copy.stages[run.targetStage]}</DetailRow>
            <DetailRow label={copy.tokenBudget}>{typeof context.tokenBudget === "number" ? formatNumber(locale, context.tokenBudget) : "—"}</DetailRow>
            <DetailRow label={copy.temperature}>{String(generation.temperature ?? "—")}</DetailRow>
          </dl>
        </section>
        {/* Context usage and citation counts are already in the run summary above. */}
        <section>
          <h3 className="text-sm font-semibold text-primary">{copy.output}</h3>
          <dl className="mt-3 grid gap-2 text-sm">
            <DetailRow label={copy.result}>{outputResult}</DetailRow>
          </dl>
        </section>
      </div>
      <section>
        <h3 className="text-sm font-semibold text-primary">{copy.provenance}</h3>
        <dl className="mt-3 grid gap-2 text-sm">
          <DetailRow label={copy.lineageStatus}>{run.historicalLineage ? copy.historicalRun : copy.currentPipeline}</DetailRow>
          <DetailRow label={copy.duration}>{formatMs(locale, run.timing.durationMs)}</DetailRow>
          {typeof run.queueDurationMs === "number" ? <DetailRow label={copy.queue}>{formatMs(locale, run.queueDurationMs)}</DetailRow> : null}
          <DetailRow label={copy.reuse}>{run.reusedExperiment ? copy.reused : copy.executed}</DetailRow>
          {timings ? (Object.keys(copy.timings) as Array<keyof RetrievalCopy["timings"]>).map((key) => <DetailRow key={key} label={copy.timings[key]}>{formatMs(locale, timings[key])}</DetailRow>) : null}
        </dl>
        <TechnicalDetails className="mt-3" title={copy.identifiers}>
          <dl className="grid gap-1.5 font-mono text-xs break-all text-tertiary">
            <div><dt className="inline font-sans font-medium">{copy.document}: </dt><dd className="inline">{run.documentId}</dd></div>
            <div><dt className="inline font-sans font-medium">{copy.chunk}: </dt><dd className="inline">{run.chunkRunId}</dd></div>
            <div><dt className="inline font-sans font-medium">{copy.embedding}: </dt><dd className="inline">{run.embeddingRunId || "—"}</dd></div>
            <div><dt className="inline font-sans font-medium">{copy.fingerprint}: </dt><dd className="inline">{run.experimentFingerprint || "—"}</dd></div>
          </dl>
        </TechnicalDetails>
      </section>
    </Disclosure>
  );
}

/* ------------------------------------------------------------------ */
/* Composer controls                                                   */

/** Dense / Hybrid / Keyword as pressed toggle buttons with a sliding pill (SegmentedControl look). */
function ModeToggle({ copy, mode, onChange }: { copy: RetrievalCopy; mode: RetrievalMode; onChange: (mode: RetrievalMode) => void }) {
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement>("[data-selected]");
  return (
    <div aria-label={copy.mode} className="relative inline-flex h-9 rounded-lg bg-tertiary p-0.5 ring-1 ring-secondary ring-inset max-sm:flex-1 dark:bg-secondary_alt" data-testid="playground-mode-control" ref={containerRef} role="group">
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 rounded-md bg-primary opacity-0 shadow-sm ring-1 ring-secondary_alt transition-[translate,width,opacity] duration-(--tabs-dur) ease-(--tabs-ease) dark:bg-quaternary" ref={indicatorRef} />
      {MODES.map((value) => (
        <button
          aria-pressed={mode === value}
          className="relative z-10 inline-flex h-8 cursor-pointer items-center justify-center rounded-md px-3 text-sm font-semibold whitespace-nowrap text-tertiary transition-colors duration-150 hover:text-secondary aria-pressed:text-primary max-sm:flex-1"
          data-selected={mode === value || undefined}
          key={value}
          onClick={() => onChange(value)}
          type="button"
        >
          {copy.modes[value]}
        </button>
      ))}
    </div>
  );
}

function TopKControl({ copy, onChange, value }: { copy: RetrievalCopy; onChange: (value: string) => void; value: string }) {
  const numericValue = Number(value);
  const stepButton = "grid size-8 cursor-pointer place-items-center rounded-md text-fg-quaternary transition-colors duration-150 hover:bg-primary_hover hover:text-fg-secondary disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent";
  return (
    <div className="flex h-9 items-center rounded-lg bg-primary p-0.5 shadow-xs ring-1 ring-control ring-inset">
      <button aria-label={copy.decreaseTopK} className={stepButton} disabled={numericValue <= 3} onClick={() => onChange(String(Math.max(3, numericValue - 1)))} type="button"><AppIcon className="size-4" name="minus" /></button>
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger aria-label={copy.topK} className="h-8 w-9 justify-center rounded-md bg-transparent px-0 font-semibold shadow-none ring-0 tabular-nums hover:bg-primary_hover focus:ring-0 focus-visible:ring-2 focus-visible:ring-brand [&>svg]:hidden">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TOP_K_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
        </SelectContent>
      </Select>
      <button aria-label={copy.increaseTopK} className={stepButton} disabled={numericValue >= 10} onClick={() => onChange(String(Math.min(10, numericValue + 1)))} type="button"><AppIcon className="size-4" name="plus" /></button>
    </div>
  );
}

const pearlKbd = "bg-transparent text-current opacity-70 shadow-none ring-current/30";

/** Busy glyph for the pearl CTA: track and arc both follow the pearl's text colour in light and dark. */
function PearlSpinner() {
  return (
    <svg aria-hidden="true" className="size-5 shrink-0 animate-spin motion-reduce:animate-none" fill="none" viewBox="0 0 20 20">
      <circle className="stroke-current opacity-25" cx="10" cy="10" r="7.5" strokeWidth="2" />
      <path className="stroke-current" d="M17.5 10a7.5 7.5 0 0 0-7.5-7.5" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Screen                                                              */

export function RetrievalScreen() {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const allCopy = UI_COPY[locale];
  const copy = allCopy.retrieval;
  const {
    activeDocument,
    activePipeline,
    selectedParseResult: parseResult,
    persistenceStatus,
    workspaceStatus,
    selectedParseRunId,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    experimentStatus,
    experimentRun,
    experimentError,
    experimentHistory,
    runExperiment,
    loadExperiment,
    resumeRunTracking,
    continueExperiment,
    rerunGeneration,
  } = useDocumentPipeline();
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(DEFAULT_TOP_K);
  const [mode, setMode] = useState<RetrievalMode>(DEFAULT_MODE);
  const [rerankerEnabled, setRerankerEnabled] = useState(false);
  const [candidateCount, setCandidateCount] = useState(DEFAULT_CANDIDATE_COUNT);
  const [tokenBudget, setTokenBudget] = useState(DEFAULT_TOKEN_BUDGET);
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE);
  const [targetStage, setTargetStage] = useState<ExperimentTargetStage>("generation");
  const [activeStage, setActiveStage] = useState<PlaygroundStage>("retrieval");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const draftRunIdRef = useRef<string | null>(null);
  const historySelectionRef = useRef<string | null>(null);
  const watchedRunRef = useRef<string | null>(null);
  const questionRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const clearCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => clearCleanup.current?.(), []);
  const selectedSample = sampleForHash(activeDocument?.sha256);
  const isApple = useIsApplePlatform();

  const restoreDraft = useCallback((run: ExperimentRun) => {
    const retrieval = objectValue(run.config.retrieval);
    setQuestion(run.query);
    setTopK(String(numberValue(retrieval.topK, 5)));
    const savedMode = experimentRetrievalMode(run.config);
    setMode(savedMode === "keyword" || savedMode === "dense" ? savedMode : "hybrid");
    setRerankerEnabled(Boolean(objectValue(run.config.reranking).enabled));
    setCandidateCount(numberValue(objectValue(run.config.reranking).candidateCount, DEFAULT_CANDIDATE_COUNT));
    setTokenBudget(numberValue(objectValue(run.config.context).tokenBudget, DEFAULT_TOKEN_BUDGET));
    setTemperature(numberValue(objectValue(run.config.generation).temperature, DEFAULT_TEMPERATURE));
    setTargetStage(run.targetStage);
  }, []);
  // Hydrate only when the selected run changes, never on polling updates.
  useEffect(() => {
    if (!experimentRun || experimentRun.id === draftRunIdRef.current) return;
    draftRunIdRef.current = experimentRun.id;
    restoreDraft(experimentRun);
    if (historySelectionRef.current === experimentRun.id) {
      setActiveStage(lastAvailableStage(experimentRun));
      historySelectionRef.current = null;
    }
    setCopyStatus("idle");
  }, [experimentRun, restoreDraft]);
  useEffect(() => {
    if (copyStatus === "idle") return;
    const timeout = window.setTimeout(() => setCopyStatus("idle"), 2_000);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);
  // A run watched while queued/running announces itself once when it completes.
  useEffect(() => {
    if (!experimentRun) return;
    if (isInProgress(experimentRun)) {
      watchedRunRef.current = experimentRun.id;
      return;
    }
    if (watchedRunRef.current !== experimentRun.id) return;
    watchedRunRef.current = null;
    if (experimentRun.status !== "completed") return;
    const generation = experimentRun.stageResults.generation;
    const outcome = generation ? generationOutcome(generation) : null;
    const result = outcome === "answered" ? copy.outcomes.answered
      : outcome === "insufficient_context" ? copy.outcomes.insufficient
        : outcome === "grounding_rejected" ? copy.outcomes.rejected
          : copy.stages[experimentRun.targetStage];
    toast(copy.runComplete, {
      description: [result, typeof experimentRun.timing.durationMs === "number" ? formatMs(locale, experimentRun.timing.durationMs) : null].filter(Boolean).join(" · "),
      icon: <AppIcon className="size-5 text-fg-tertiary" name="completed" />,
    });
  }, [copy, experimentRun, locale]);

  async function copyTrace() {
    setCopyStatus("idle");
    try {
      await navigator.clipboard.writeText(JSON.stringify(experimentRun, null, 2));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  const processing = experimentStatus === "processing";
  const hasChanges = question.length > 0 || topK !== DEFAULT_TOP_K || mode !== DEFAULT_MODE || rerankerEnabled || candidateCount !== DEFAULT_CANDIDATE_COUNT || tokenBudget !== DEFAULT_TOKEN_BUDGET || temperature !== DEFAULT_TEMPERATURE || targetStage !== "generation";
  // One shared prerequisite check (stale/incompatible lineage included). Loading is never a
  // blocker, and an empty question is the normal starting state, not an error.
  const availability = getPipelineAvailability(locale, "retrieval", {
    document: activeDocument,
    pipeline: activePipeline,
    selection: { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId },
    parseRun: activeDocument?.parseRuns?.find((run) => run.id === selectedParseRunId) ?? null,
    chunkRun: activeDocument?.chunkRuns?.find((run) => run.id === selectedChunkRunId) ?? null,
    embeddingRun: mode === "keyword" ? null : activeDocument?.embeddingRuns?.find((run) => run.id === selectedEmbeddingRunId) ?? null,
    hasQuestion: true,
    retrievalMode: mode,
    persistenceStatus,
    workspaceStatus,
    processing,
  });
  const canAsk = availability.allowed && question.trim().length > 0;
  const disabledReason = !availability.allowed ? availability.message : question.trim() ? "" : copy.enterQuestion;
  const showBlocker = !availability.allowed && availability.code !== "loading" && availability.code !== "processing";
  const results = experimentRun?.stageResults;
  const hasRunError = Boolean(experimentError || experimentRun?.status === "failed");
  const savedRunMatches = experimentRun ? savedRunMatchesDraft(experimentRun, { question, topK, mode, rerankerEnabled, candidateCount, tokenBudget, temperature, targetStage }) : false;
  const canContinue = Boolean(experimentRun && experimentRun.status === "completed" && experimentRun.targetStage !== "generation" && !processing);
  const canRerunGeneration = Boolean(experimentRun && experimentRun.status === "completed" && results?.generation && !processing);
  const answered = Boolean(experimentRun?.status === "completed" && results?.generation && generationOutcome(results.generation) === "answered");
  const selectedComparisonRuns = useMemo(() => experimentHistory.filter((run): run is ExperimentRun => compareIds.includes(run.id) && isExperimentDetail(run)), [compareIds, experimentHistory]);
  const historyPosition = (runId: string) => {
    const index = experimentHistory.findIndex((run) => run.id === runId);
    return index < 0 ? 1 : experimentHistory.length - index;
  };
  const runNumberOf = (run: { id: string; runNumber?: number | null }) => run.runNumber ?? historyPosition(run.id);
  const experimentName = (run: { id: string; runNumber?: number | null }) => runName(allCopy, "experiment", runNumberOf(run));
  const source: SourceContext = { documentId: activeDocument?.id ?? null, parseResult };
  const activeStatus = experimentRun ? stageStatusFor(experimentRun, activeStage, copy, locale) : null;
  const activePending = Boolean(experimentRun && isInProgress(experimentRun) && !results?.[activeStage] && activeStatus && (activeStatus.tone === "running" || activeStatus.tone === "waiting"));
  const resultDate = experimentRun ? runDate(experimentRun, locale, "medium") : null;

  function reset() {
    setQuestion("");
    setTopK(DEFAULT_TOP_K);
    setMode(DEFAULT_MODE);
    setRerankerEnabled(false);
    setCandidateCount(DEFAULT_CANDIDATE_COUNT);
    setTokenBudget(DEFAULT_TOKEN_BUDGET);
    setTemperature(DEFAULT_TEMPERATURE);
    setTargetStage("generation");
  }

  function submit() {
    if (!canAsk) return;
    setActiveStage(targetStage);
    void runExperiment({
      query: question.trim(),
      targetStage,
      retrieval: { mode, topK: Number(topK) },
      reranking: { enabled: rerankerEnabled, candidateCount },
      context: { tokenBudget },
      generation: { temperature, maxOutputTokens: 1024 },
    });
  }

  function handleQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }

  function clearQuestion() {
    clearCleanup.current?.();
    clearCleanup.current = clearQuestionTransition(questionRef.current, question);
    setQuestion("");
    // The clear button unmounts with the text; keep keyboard focus in the field.
    textareaRef.current?.focus();
  }

  function pickSampleQuestion(suggestion: string) {
    clearCleanup.current?.();
    setQuestion(suggestion);
    textareaRef.current?.focus();
  }

  function toggleCompare(runId: string) {
    setCompareIds((current) => current.includes(runId) ? current.filter((id) => id !== runId) : current.length < 2 ? [...current, runId] : [current[1], runId]);
  }

  function loadHistoryRun(run: ExperimentRun | ExperimentSummary) {
    if (experimentRun?.id === run.id) {
      restoreDraft(experimentRun);
      setActiveStage(lastAvailableStage(experimentRun));
      return;
    }
    historySelectionRef.current = run.id;
    void loadExperiment(run.id);
  }

  return (
    <div className="min-w-0 bg-canvas" data-testid="playground-screen">
      <div className="mx-auto w-full max-w-7xl p-10 max-md:p-4">
        <PageHeader
          data-testid="playground-page-header"
          description={copy.description}
          help={preferences.showLearningHints ? <div data-testid="playground-question-help"><HowItWorks>{copy.howItWorks}</HowItWorks></div> : null}
          title={copy.title}
        />

        <Panel aria-label={copy.title} className="mt-8 max-sm:p-4" data-testid="playground-input">
          <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <div className="flex items-center gap-3 max-md:flex-col max-md:items-stretch">
              {/* A clearly bounded field: control-strength ring, brand ring on focus, leading glyph. */}
              <div className="group/field relative flex min-w-0 flex-1 items-start rounded-xl bg-primary py-1 shadow-xs ring-1 ring-control ring-inset transition-shadow duration-150 focus-within:ring-2 focus-within:ring-brand hover:ring-control_hover focus-within:hover:ring-brand">
                <AppIcon className="mt-2.5 ml-3.5 size-5 shrink-0 text-fg-quaternary transition-colors duration-150 group-focus-within/field:text-fg-brand-primary" name="retrieve" />
                <div className="t-clear steplab-clear relative min-w-0 flex-1 text-md leading-6" ref={questionRef}>
                  <label className="sr-only" htmlFor="retrieval-question">{copy.question}</label>
                  <textarea
                    aria-keyshortcuts="Control+Enter Meta+Enter"
                    aria-label={copy.question}
                    className="block max-h-48 min-h-16 w-full resize-none bg-transparent px-3 py-2 text-md leading-6 text-primary outline-none field-sizing-content placeholder:text-placeholder"
                    data-testid="playground-question"
                    id="retrieval-question"
                    onChange={(event) => { clearCleanup.current?.(); setQuestion(event.target.value); }}
                    onKeyDown={handleQuestionKeyDown}
                    placeholder={copy.placeholder}
                    ref={textareaRef}
                    rows={2}
                    value={question}
                  />
                  <div aria-hidden="true" className="t-clear-mirror" /><div aria-hidden="true" className="t-clear-glow" />
                </div>
                <div className="flex w-11 shrink-0 justify-center pt-1">
                  {question ? <Button aria-label={copy.clearQuestion} onClick={clearQuestion} size="icon-sm" type="button" variant="tertiary"><AppIcon className="size-4" name="close" /></Button> : null}
                </div>
              </div>
              <Button
                aria-describedby={!canAsk ? "ask-disabled-reason" : undefined}
                aria-disabled={processing || undefined}
                aria-keyshortcuts="Control+Enter Meta+Enter"
                className="max-md:w-full"
                data-testid="playground-run-cta"
                disabled={!canAsk && !processing}
                iconLeading={processing ? <PearlSpinner /> : "generate"}
                size="xl"
                type="submit"
                variant="pearl"
              >
                {copy.run}
                <span aria-hidden="true" className="ml-1.5 hidden items-center gap-0.5 sm:inline-flex">
                  <Kbd className={pearlKbd}>{isApple ? "⌘" : "Ctrl"}</Kbd>
                  <Kbd className={pearlKbd}>↵</Kbd>
                </span>
              </Button>
            </div>
            {!canAsk && disabledReason ? <span className="sr-only" id="ask-disabled-reason">{disabledReason}</span> : null}
          </form>

          {selectedSample ? (
            <div aria-label={copy.sampleQuestions} className="mt-4 flex flex-wrap items-center gap-2" data-testid="sample-questions" role="group">
              {selectedSample.questions.map((suggestion) => (
                <button
                  className={cn(
                    "group/sample inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-left text-sm text-secondary shadow-xs ring-1 ring-secondary ring-inset",
                    "transition-[background-color,color,box-shadow,translate] duration-150 ease-out hover:-translate-y-px hover:bg-primary_hover hover:text-primary hover:ring-primary active:translate-y-0",
                    question === suggestion && "bg-active text-primary ring-primary",
                  )}
                  key={suggestion}
                  onClick={() => pickSampleQuestion(suggestion)}
                  type="button"
                >
                  <AppIcon className="size-3.5 shrink-0 text-fg-quaternary transition-colors group-hover/sample:text-fg-brand-primary" name="generate" />
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-secondary pt-4" data-testid="playground-primary-controls">
            {/* On phones the label sits above the toggle; side by side they overflow 320px. */}
            <div className="flex items-center gap-2.5 max-sm:w-full max-sm:flex-col max-sm:items-start max-sm:gap-1.5">
              <span className="text-sm font-medium text-tertiary">{copy.retrieval}</span>
              <ModeToggle copy={copy} mode={mode} onChange={setMode} />
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-sm font-medium text-tertiary">{copy.topK}</span>
              <div data-testid="playground-top-k-control"><TopKControl copy={copy} onChange={setTopK} value={topK} /></div>
            </div>
            <label className="flex h-9 cursor-pointer items-center gap-2.5" data-testid="playground-reranker-control" htmlFor="reranker-enabled">
              <span className="text-sm font-medium text-tertiary">{copy.reranker}</span>
              <Switch aria-label={copy.reranker} checked={rerankerEnabled} className="h-9" id="reranker-enabled" onCheckedChange={setRerankerEnabled} />
            </label>
            {/* The run state sits at the end of the controls row so starting a run never shifts the results. */}
            {!hasRunError && processing ? (
              <p className="flex min-h-9 items-center gap-2 text-sm font-medium text-brand-secondary sm:ml-auto" data-testid="playground-run-state" role="status">
                <Spinner size="xs" /><ThinkingText>{copy.running}</ThinkingText>
              </p>
            ) : null}
            {!hasRunError && !processing && experimentRun?.status === "completed" && !savedRunMatches ? (
              <p className="flex max-w-md min-w-0 items-start gap-2 text-sm text-warning-primary sm:ml-auto" data-testid="playground-run-state" role="status">
                <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-fg-warning-secondary" />{copy.settingsChanged}
              </p>
            ) : null}
          </div>

          <div className="mt-3" data-testid="playground-utilities">
            <Disclosure data-testid="playground-advanced" title={copy.advanced} variant="inline">
              <div className="grid gap-4 pt-2 sm:grid-cols-2 lg:grid-cols-4">
                <Field label={copy.targetStage}>
                  {(control) => (
                    <Select onValueChange={(value) => setTargetStage(value as ExperimentTargetStage)} value={targetStage}>
                      <SelectTrigger aria-describedby={control["aria-describedby"]} id={control.id}><SelectValue /></SelectTrigger>
                      <SelectContent>{STAGES.map((stage) => <SelectItem key={stage} value={stage}>{copy.stages[stage]}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </Field>
                {/* The candidate count only means something when the reranker runs. */}
                {rerankerEnabled ? (
                  <Field label={copy.candidateCount}>
                    <Input className="tabular-nums" id="candidate-count" max={Math.max(20, Number(topK) * 4)} min={Number(topK)} onChange={(event) => setCandidateCount(Number(event.target.value))} type="number" value={candidateCount} />
                  </Field>
                ) : null}
                <Field label={copy.tokenBudget}>
                  <Input className="tabular-nums" id="context-budget" max={12000} min={256} onChange={(event) => setTokenBudget(Number(event.target.value))} type="number" value={tokenBudget} />
                </Field>
                <Field label={copy.temperature}>
                  <Input className="tabular-nums" id="generation-temperature" max={2} min={0} onChange={(event) => setTemperature(Number(event.target.value))} step="0.1" type="number" value={temperature} />
                </Field>
              </div>
              <div className="mt-4">
                <Button aria-describedby={!hasChanges ? "retrieval-reset-disabled-reason" : undefined} disabled={!hasChanges} iconLeading="reset" onClick={reset} size="sm" variant="secondary">{copy.reset}</Button>
                {!hasChanges ? <span className="sr-only" id="retrieval-reset-disabled-reason">{copy.nothingToReset}</span> : null}
              </div>
            </Disclosure>
          </div>

        </Panel>

        {showBlocker ? <PlaygroundBlocker availability={availability} compact={Boolean(experimentRun || hasRunError)} /> : null}
        {hasRunError ? <ExperimentErrorSurface copy={copy} error={experimentError} /> : null}
        {!experimentRun && !hasRunError && availability.code === "loading" ? <Skeleton className="mt-6" label={copy.loading} rows={3} rowClassName="h-14 rounded-xl" /> : null}
        {!experimentRun && !hasRunError && availability.allowed ? (
          <EmptyState action={<StagePreview copy={copy} />} className="mt-10 py-16" icon="generate" title={copy.readyTitle} titleAs="h2" />
        ) : null}

        {experimentRun ? <>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-tertiary tabular-nums" data-testid="playground-result-meta">
              <span className="text-md font-semibold text-primary">{experimentName(experimentRun)}</span>
              {resultDate ? <span><span aria-hidden="true" className="mr-2 text-quaternary">·</span>{resultDate}</span> : null}
              {experimentRun.reusedExperiment ? (
                <Badge className="ml-1" icon="history" title={copy.reusedHint}>{copy.reused}<span className="sr-only">. {copy.reusedHint}</span></Badge>
              ) : null}
            </p>
            <div className="flex flex-wrap items-center gap-2" data-testid="playground-current-actions">
              {copyStatus !== "idle" ? <span className="text-sm text-tertiary" role="status"><TransitionText>{copyStatus === "copied" ? copy.traceCopied : copy.copyFailed}</TransitionText></span> : null}
              {isInProgress(experimentRun) && !processing ? <Button onClick={() => void resumeRunTracking("experiment")} size="sm" variant="secondary">{copy.resumeTracking}</Button> : null}
              {canContinue ? <Button iconLeading="play" onClick={() => void continueExperiment()} size="sm" variant="secondary">{copy.runNextStage}</Button> : null}
              {results?.generation ? <Button disabled={!canRerunGeneration} iconLeading="refresh" onClick={() => void rerunGeneration()} size="sm" variant="tertiary">{copy.regenerate}</Button> : null}
              <Button onClick={() => void copyTrace()} size="sm" variant="tertiary">
                <span className="size-4"><IconSwap active={copyStatus === "copied"} first={<AppIcon className="size-4" name="copy" />} second={<AppIcon className="size-4" name="check" />} /></span>
                {copy.copyTrace}
              </Button>
              {answered ? (
                <Link className={buttonStyles({ variant: "secondary", size: "sm" })} data-testid="playground-continue-evaluation" href="/evaluation">
                  {allCopy.overview.continuation.evaluation}<AppIcon className="size-4" name="arrowRight" />
                </Link>
              ) : null}
            </div>
          </div>

          <Panel className="mt-4 overflow-hidden" padding="none">
            <RunSummary copy={copy} locale={locale} run={experimentRun} />
            <div className="lg:flex lg:gap-5" data-testid="playground-stage-layout">
              <aside aria-labelledby="playground-stages-title" className="min-w-0 border-b border-secondary bg-secondary p-3 lg:w-65 lg:shrink-0 lg:border-r lg:border-b-0 lg:py-4 dark:bg-secondary_alt" data-testid="playground-stage-rail">
                <h2 className="sr-only" id="playground-stages-title">{copy.stagesTitle}</h2>
                <ExperimentStageTrace activeStage={activeStage} copy={copy} locale={locale} onSelect={setActiveStage} run={experimentRun} />
              </aside>

              <TransitionPanel as="section" className="min-w-0 flex-1 p-5 sm:p-6 lg:pl-1" data-testid="playground-stage-content" transitionKey={`${experimentRun.id}:${activeStage}:${results?.[activeStage]?.durationMs}`}>
                {activePending && activeStatus ? <StagePending copy={copy} stage={activeStage} status={activeStatus} /> : <>
                  {activeStage === "retrieval" ? <RetrievalStageView copy={copy} locale={locale} run={experimentRun} source={source} /> : null}
                  {activeStage === "reranking" ? <RerankingStageView copy={copy} locale={locale} run={experimentRun} source={source} /> : null}
                  {activeStage === "context" ? <ContextStageView copy={copy} locale={locale} run={experimentRun} /> : null}
                  {activeStage === "generation" ? <AnswerStageView copy={copy} locale={locale} run={experimentRun} source={source} /> : null}
                </>}
              </TransitionPanel>
            </div>
          </Panel>

          {experimentRun.status === "completed" || experimentRun.status === "failed" ? <ExperimentDetails copy={copy} locale={locale} run={experimentRun} /> : null}
        </> : null}

        {experimentHistory.length ? (
          <Disclosure className="mt-4" contentClassName="p-0" data-testid="playground-history" meta={formatNumber(locale, experimentHistory.length)} title={copy.history}>
            <p className="px-5 pt-3 pb-1 text-sm text-tertiary tabular-nums">{compareIds.length ? interpolate(copy.selectedRuns, { count: compareIds.length }) : copy.compareHint}</p>
            <ul className="divide-y divide-secondary">
              {experimentHistory.map((run) => {
                const name = experimentName(run);
                const current = experimentRun?.id === run.id;
                const selected = compareIds.includes(run.id);
                const meta = [modeLabel(experimentRetrievalMode(run.config), copy), interpolate(copy.topKValue, { k: String(objectValue(run.config.retrieval).topK ?? "—") }), runDate(run, locale, "short")].filter(Boolean).join(" · ");
                return (
                  <li aria-current={current || undefined} className={cn("flex min-w-0 items-center gap-3 px-5 py-3 transition-colors duration-150", current ? "bg-secondary" : "hover:bg-primary_hover")} key={run.id}>
                    <Checkbox aria-label={interpolate(copy.compareRun, { name })} isDisabled={!selected && compareIds.length >= 2} isSelected={selected} onChange={() => toggleCompare(run.id)} />
                    <span className="flex w-9 shrink-0 items-center gap-1.5 text-xs font-medium text-quaternary tabular-nums">
                      {current ? <span aria-hidden="true" className="size-1.5 rounded-full bg-fg-brand-primary" /> : null}#{runNumberOf(run)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-primary">{run.query || name}</p>
                      <p className="mt-0.5 truncate text-xs text-tertiary tabular-nums">{meta}</p>
                    </div>
                    {run.status === "failed" ? <StatusBadge appearance="icon" status="error">{copy.stageStatus.failed}</StatusBadge>
                      : isInProgress(run) ? <StatusBadge appearance="icon" status="processing">{copy.stageStatus.running}</StatusBadge> : null}
                    <Button aria-label={interpolate(copy.loadRun, { name })} onClick={() => loadHistoryRun(run)} size="sm" variant="tertiary">{copy.load}</Button>
                  </li>
                );
              })}
            </ul>
            {selectedComparisonRuns.length ? (
              <div className="grid gap-x-10 gap-y-6 border-t border-secondary px-5 py-5 md:grid-cols-2" data-testid="playground-history-compare">
                {selectedComparisonRuns.map((run) => (
                  <div className="min-w-0" key={run.id}>
                    <p className="text-sm font-semibold text-primary">{experimentName(run)}</p>
                    <p className="mt-0.5 truncate text-sm text-tertiary">{run.query}</p>
                    <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                      <div><dt className="text-xs text-tertiary">{copy.mode}</dt><dd className="mt-1 text-md font-semibold text-primary">{modeLabel(experimentRetrievalMode(run.config), copy)}</dd></div>
                      <div><dt className="text-xs text-tertiary">{copy.candidates}</dt><dd className="mt-1 text-md font-semibold text-primary"><MetricValue value={(run.stageResults.retrieval?.results ?? run.stageResults.retrieval?.candidates ?? []).length} /></dd></div>
                      <div><dt className="text-xs text-tertiary">{copy.validCitations}</dt><dd className="mt-1 text-md font-semibold text-primary"><MetricValue value={run.stageResults.generation?.citations.filter((citation) => citation.valid).length ?? 0} /></dd></div>
                      <div><dt className="text-xs text-tertiary">{copy.duration}</dt><dd className="mt-1 text-md font-semibold text-primary tabular-nums">{formatMs(locale, run.timing.durationMs)}</dd></div>
                    </dl>
                  </div>
                ))}
              </div>
            ) : null}
          </Disclosure>
        ) : null}
      </div>
    </div>
  );
}
