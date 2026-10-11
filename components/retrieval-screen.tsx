"use client";

import Link from "next/link";
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { StageBlocker } from "@/components/stage-blocker";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { Disclosure, HowItWorks, TechnicalDetails } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusIcon } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { ThinkingText, TransitionCheckbox, TransitionPanel, TransitionText } from "@/components/ui/transitions";
import { getPipelineAvailability } from "@/lib/blockers";
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

type PlaygroundStage = "retrieval" | "reranking" | "context" | "generation";
type RetrievalCopy = AppCopy["retrieval"];
type StageResults = ExperimentRun["stageResults"];
type GenerationResult = NonNullable<StageResults["generation"]>;
type SourceContext = { documentId: string | null; parseResult: DocumentParseResponse | null };

const STAGES = ["retrieval", "reranking", "context", "generation"] as const;
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

/** A citation names a chunk; its title is the chunk heading, else the start of its text. */
function chunkTitle(chunkId: string, results: StageResults) {
  const pools = [results.retrieval?.results ?? [], results.retrieval?.candidates ?? [], results.reranking?.candidates ?? [], results.reranking?.inputCandidates ?? []];
  for (const pool of pools) {
    const match = pool.find((item) => item.chunkId === chunkId);
    if (match?.headingPath.length) return match.headingPath.join(" › ");
    if (match?.text.trim()) return excerpt(match.text);
  }
  const contextMatch = results.context?.candidates.find((item) => item.chunkId === chunkId);
  return contextMatch?.text.trim() ? excerpt(contextMatch.text) : null;
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

function ExperimentStageTrace({ activeStage, copy, locale, onSelect, run }: { activeStage: PlaygroundStage; copy: RetrievalCopy; locale: AppLocale; onSelect: (stage: PlaygroundStage) => void; run: ExperimentRun }) {
  const completedCount = STAGES.filter((stage) => Boolean(run.stageResults[stage])).length;
  const rerankerEnabled = Boolean(objectValue(run.config.reranking).enabled);
  const statusFor = (stage: PlaygroundStage): { label: string; tone: "done" | "skipped" | "running" | "failed" | "waiting" } => {
    const result = run.stageResults[stage];
    if (result) {
      if (stage === "reranking" && "executed" in result && !result.executed) return { label: copy.stageStatus.skipped, tone: "skipped" };
      return { label: typeof result.durationMs === "number" ? formatMs(locale, result.durationMs) : "", tone: "done" };
    }
    const index = STAGES.indexOf(stage);
    if (run.status === "queued") return { label: index === 0 ? copy.stageStatus.queued : copy.stageStatus.waiting, tone: "waiting" };
    if (run.status === "running" && index === completedCount) return { label: copy.stageStatus.running, tone: "running" };
    if (run.status === "failed" && index === completedCount) return { label: copy.stageStatus.failed, tone: "failed" };
    if (stage === "reranking" && !rerankerEnabled && run.status === "completed") return { label: copy.stageStatus.skipped, tone: "skipped" };
    return { label: copy.stageStatus.waiting, tone: "waiting" };
  };
  const toneText = { done: "text-muted-foreground", skipped: "text-subtle-foreground", running: "text-warning", failed: "text-destructive", waiting: "text-subtle-foreground" } as const;
  const toneDot = { done: "bg-muted-foreground", skipped: "bg-input", running: "bg-warning", failed: "bg-destructive", waiting: "border border-input bg-card" } as const;

  return (
    // Mobile: a 2×2 grid keeps every stage visible (no clipped horizontal strip); desktop: a vertical rail.
    <ol aria-label={copy.stagesLabel} className="grid grid-cols-2 gap-1 lg:flex lg:flex-col" data-testid="experiment-stage-trace">
      <li className="hidden min-h-9 items-center gap-2 px-1.5 py-1.5 lg:flex">
        <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground"><AppIcon name="retrieve" className="size-3" /></span>
        <div className="min-w-0"><p className="text-sm font-medium text-foreground">{copy.query}</p><span className="sr-only">{run.query || copy.waitingToRun}</span></div>
      </li>
      {typeof run.queueDurationMs === "number" ? (
        <li className="col-span-2 flex min-h-9 items-center gap-2 px-3 py-2 text-sm text-muted-foreground lg:gap-3" data-testid="experiment-stage-queue" title={copy.queueHint}>
          <span aria-hidden="true" className="size-3 shrink-0 rounded-full border border-dashed border-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{copy.queue}</span>
          <span className="shrink-0 text-xs tabular-nums">{formatMs(locale, run.queueDurationMs)}</span>
          <span className="sr-only">{copy.queueHint}</span>
        </li>
      ) : null}
      {STAGES.map((stage) => {
        const status = statusFor(stage);
        const active = activeStage === stage;
        return (
          <li className="min-w-0" key={stage}>
            <button aria-pressed={active} className={`flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-3 py-2 text-left lg:gap-3 ${active ? "bg-secondary" : "hover:bg-surface-subtle"}`} onClick={() => onSelect(stage)} type="button">
              <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${toneDot[status.tone]}`} />
              <span className={`min-w-0 flex-1 truncate text-sm text-foreground ${active ? "font-medium" : "font-normal"}`}>{copy.stages[stage]}</span>
              {status.label ? <span className={`shrink-0 text-xs tabular-nums ${toneText[status.tone]}`}>{status.label}</span> : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** Reuse is the exception worth showing; executing a stage is the default and stays in Details. */
function StageReuseNote({ copy, reuse, stage }: { copy: RetrievalCopy; reuse?: StageReuseMetadata | null; stage: string }) {
  if (!reuse?.reused) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid={`stage-reuse-${stage}`}>
      <span className="inline-flex items-center gap-1.5" title={copy.reusedHint}><AppIcon name="history" className="size-3.5" />{copy.reused}</span>
      {reuse.sourceExperimentId ? <TechnicalDetails><span className="break-all font-mono text-xs">{reuse.sourceExperimentId}</span></TechnicalDetails> : null}
    </div>
  );
}

function StageHeading({ title, description, meta }: { title: string; description?: string | null; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 max-w-[560px] text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {meta}
    </div>
  );
}

function CitationChip({ citation, copy, source }: { citation: ValidatedCitation; copy: RetrievalCopy; source: SourceContext }) {
  return <SourceInspector documentId={source.documentId} pageNumbers={citation.pageNumbers} parseResult={source.parseResult} sourceElementIds={citation.sourceElementIds} triggerAriaLabel={interpolate(copy.inspectSource, { label: citation.citationId })} triggerLabel={citation.citationId} variant="chip" />;
}

function RetrievalStageView({ copy, locale, run, source }: { copy: RetrievalCopy; locale: AppLocale; run: ExperimentRun; source: SourceContext }) {
  const units = UI_COPY[locale].units;
  const stage = run.stageResults.retrieval;
  // The top-K list is what reached the next stage; older payloads only carry `candidates`.
  const items = stage?.results ?? stage?.candidates ?? [];
  const scoreLabel = scoreLabelFor(stage?.scoreSemantics, experimentRetrievalMode(run.config), copy);
  const reranking = run.stageResults.reranking;
  const rerankerInput = reranking?.executed ? reranking.inputCandidates?.length ?? null : null;
  return (
    <>
      <StageHeading
        description={copy.retrievedDescription}
        meta={rerankerInput !== null ? <span className="text-xs text-muted-foreground tabular-nums" data-testid="playground-reranker-input">{interpolate(copy.rerankerInput, { count: formatCount(locale, rerankerInput, units.candidate) })}</span> : null}
        title={copy.retrievedTitle}
      />
      <StageReuseNote copy={copy} reuse={stage?.reuse} stage="retrieval" />
      {items.length ? (
        <>
          <p className="sr-only">{copy.scoreHint}</p>
          <ol aria-label={copy.retrievedTitle} className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
            {items.map((candidate) => {
              const heading = candidate.headingPath.join(" › ") || copy.sourceDocument;
              const pages = pageRef(candidate.pageNumbers, units);
              return (
                <li className="flex min-w-0 items-start gap-3 p-4 sm:p-5" key={candidate.chunkId}>
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-xs font-medium text-foreground tabular-nums">{candidate.rank}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="min-w-0 break-words text-sm font-medium text-foreground">{heading}</p>
                      {/* max-w-full: the labelled score ("Fusion score (relative, diagnostic) 0.82 · p. 1") wraps
                          on its own line at 320px instead of forcing the row past the column (WCAG 1.4.10). */}
                      <p className="max-w-full shrink-0 text-xs text-muted-foreground tabular-nums"><span data-testid="candidate-score" title={copy.scoreHint}>{scoreLabel} {formatScore(candidate.score)}</span>{pages ? ` · ${pages}` : null}</p>
                    </div>
                    {/* Retrieved document text is untrusted data: rendered as plain text only. */}
                    <p className="mt-2 line-clamp-3 break-words text-sm text-muted-foreground">{candidate.text}</p>
                    <div className="mt-3"><SourceInspector documentId={source.documentId} headingPath={candidate.headingPath} pageNumbers={candidate.pageNumbers} parseResult={source.parseResult} sourceElementIds={candidate.sourceElementIds} triggerAriaLabel={interpolate(copy.inspectSource, { label: heading })} triggerLabel={copy.viewSource} /></div>
                    <TechnicalDetails className="mt-3">
                      <dl className="grid gap-1 text-xs text-muted-foreground">
                        <div><dt className="inline font-medium">{copy.scoreBreakdown}: </dt><dd className="inline tabular-nums">Dense {formatScore(candidate.denseScore, 4)} (#{candidate.denseRank ?? "—"}) · Keyword {formatScore(candidate.keywordScore, 4)} (#{candidate.keywordRank ?? "—"}) · Fusion {formatScore(candidate.fusionScore, 4)}</dd></div>
                        <div><dt className="inline font-medium">{copy.sourceElements}: </dt><dd className="inline break-all font-mono">{candidate.sourceElementIds.join(", ") || "—"}</dd></div>
                      </dl>
                    </TechnicalDetails>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : <p className="mt-4 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{copy.noCandidates}</p>}
    </>
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
      <StageHeading description={executed ? interpolate(copy.rerankingDescription, { count: formatCount(locale, inputCount, units.candidate) }) : null} title={copy.stages.reranking} />
      <StageReuseNote copy={copy} reuse={stage?.reuse} stage="reranking" />
      {executed && stage?.candidates.length ? (
        <ol aria-label={copy.stages.reranking} className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
          {stage.candidates.map((candidate) => {
            const position = candidate.rerankRank ?? candidate.rank;
            return (
              <li className="p-4" key={candidate.chunkId}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2"><span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-xs font-medium text-foreground tabular-nums">{position}</span><p className="min-w-0 text-sm font-medium text-foreground">{candidate.headingPath.join(" › ") || copy.sourceDocument}</p></div>
                  <span className="text-xs text-muted-foreground tabular-nums">{copy.originalRank} {candidate.originalRank} · {copy.rerankedPosition} {position}</span>
                </div>
                {candidate.rankedBy === "retrieval_fallback" || candidate.rerankInputTruncated ? (
                  <p className="mt-2 text-xs text-warning">{[candidate.rankedBy === "retrieval_fallback" ? copy.rankedByFallback : null, candidate.rerankInputTruncated ? copy.inputTruncated : null].filter(Boolean).join(" ")}</p>
                ) : null}
                <p className="mt-2 line-clamp-3 break-words text-sm text-muted-foreground">{candidate.text}</p>
                <div className="mt-3"><SourceInspector documentId={source.documentId} headingPath={candidate.headingPath} pageNumbers={candidate.pageNumbers} parseResult={source.parseResult} sourceElementIds={candidate.sourceElementIds} triggerAriaLabel={interpolate(copy.inspectSource, { label: candidate.headingPath.join(" › ") || copy.sourceDocument })} triggerLabel={copy.viewSource} /></div>
              </li>
            );
          })}
        </ol>
      ) : <p className="mt-4 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{executed ? copy.noCandidates : rerankerEnabled ? copy.noStageOutput : copy.rerankSkipped}</p>}
    </>
  );
}

function ContextStageView({ copy, locale, run }: { copy: RetrievalCopy; locale: AppLocale; run: ExperimentRun }) {
  const units = UI_COPY[locale].units;
  const stage = run.stageResults.context;
  const reasonLabel = (reason: string) => reason in copy.reasons ? copy.reasons[reason as keyof RetrievalCopy["reasons"]] : null;
  return (
    <>
      <StageHeading description={copy.contextDescription} title={copy.contextTitle} />
      <StageReuseNote copy={copy} reuse={stage?.reuse} stage="context" />
      {stage ? (
        <>
          {stage.candidates.length ? (
            <ol aria-label={copy.contextTitle} className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
              {stage.candidates.map((candidate, index) => {
                const reason = candidate.selected ? null : reasonLabel(candidate.reason);
                return (
                  <li className="flex min-w-0 items-start gap-3 p-4" key={`${candidate.chunkId}-${index}`}>
                    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-xs font-medium text-foreground tabular-nums">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={candidate.selected ? "inline-flex items-center gap-1.5 text-sm font-medium text-foreground" : "inline-flex items-center gap-1.5 text-sm font-medium text-subtle-foreground"}>
                          <AppIcon name={candidate.selected ? "check" : "minus"} className="size-3.5" />{candidate.selected ? copy.selected : copy.excluded}{reason ? <span className="font-normal text-muted-foreground"> · {reason}</span> : null}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">{formatCount(locale, candidate.tokenCount, units.token)}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 break-words text-sm text-muted-foreground">{candidate.text}</p>
                      <TechnicalDetails className="mt-3">
                        <dl className="grid gap-1 text-xs text-muted-foreground">
                          <div><dt className="inline font-medium">{copy.decision}: </dt><dd className="inline font-mono">{candidate.reason || "—"}</dd></div>
                          <div><dt className="inline font-medium">{copy.sourceElements}: </dt><dd className="inline break-all font-mono">{candidate.sourceElementIds.join(", ") || "—"}</dd></div>
                        </dl>
                      </TechnicalDetails>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
          <section aria-label={copy.finalContext} className="mt-5 rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{copy.finalContext}</h3>
              <span className="text-xs text-muted-foreground tabular-nums">{interpolate(copy.tokenUsage, { used: formatNumber(locale, stage.tokenCount), budget: formatNumber(locale, stage.tokenBudget) })}</span>
            </div>
            <div aria-hidden="true" className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"><div className="t-resize h-full rounded-full bg-muted-foreground" style={{ width: `${Math.min(100, (stage.tokenCount / Math.max(1, stage.tokenBudget)) * 100)}%` }} /></div>
            <Disclosure className="mt-3" title={copy.showContext} variant="inline">
              <pre aria-label={copy.finalContext} className="mt-1 max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-technical p-3 font-mono text-xs leading-5 text-foreground" role="region" tabIndex={0}>{stage.finalContext || copy.noStageOutput}</pre>
            </Disclosure>
          </section>
        </>
      ) : <p className="mt-4 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{copy.noStageOutput}</p>}
    </>
  );
}

function AnswerStageView({ copy, locale, run, source }: { copy: RetrievalCopy; locale: AppLocale; run: ExperimentRun; source: SourceContext }) {
  const units = UI_COPY[locale].units;
  const generation = run.stageResults.generation;
  if (!generation) {
    return (
      <>
        <StageHeading description={copy.answerDescription} title={copy.answerTitle} />
        <p className="mt-4 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">{copy.noAnswer}</p>
      </>
    );
  }
  const outcome = generationOutcome(generation);
  const citationsById = new Map(generation.citations.map((citation) => [citation.citationId, citation]));
  const segments = generation.segments?.length ? generation.segments : null;
  const rejectedToken = generation.groundingFailureDetail?.token;
  return (
    <>
      <StageHeading description={copy.answerDescription} title={copy.answerTitle} />
      <StageReuseNote copy={copy} reuse={generation.reuse} stage="generation" />
      <div className="mt-4" data-testid="playground-answer">
        {outcome === "grounding_rejected" ? (
          <div className="rounded-lg border border-warning-border bg-warning-subtle p-4" data-testid="playground-grounding-rejected" role="status">
            <p className="text-sm font-medium text-warning">{rejectedToken ? interpolate(copy.groundingRejected, { token: rejectedToken }) : copy.groundingRejectedGeneric}</p>
            <p className="mt-1 text-xs text-warning">{copy.groundingRejectedHint}</p>
          </div>
        ) : outcome === "insufficient_context" ? (
          <div className="rounded-lg border border-warning-border bg-warning-subtle p-4" data-testid="playground-insufficient-context" role="status">
            <h3 className="text-base font-semibold text-warning">{copy.insufficientTitle}</h3>
            <p className="mt-1 text-sm text-warning">{copy.insufficientBody}</p>
          </div>
        ) : segments ? (
          // One paragraph; each validated segment ends with its clickable citation markers.
          <p className="break-words text-base leading-7 text-foreground">
            {segments.map((segment, index) => (
              <span key={index}>
                {index ? " " : null}{segment.text}
                {segment.citationIds.map((citationId) => {
                  const citation = citationsById.get(citationId);
                  return citation ? <CitationChip citation={citation} copy={copy} key={citationId} source={source} /> : <span className="mx-0.5 font-mono text-xs text-muted-foreground" key={citationId}>[{citationId}]</span>;
                })}
              </span>
            ))}
          </p>
        ) : generation.answer.trim() ? <p className="break-words text-base leading-7 text-foreground">{generation.answer}</p> : <p className="text-sm text-muted-foreground">{copy.noAnswer}</p>}
      </div>
      {generation.citations.length ? (
        <section aria-labelledby="playground-citations-title" className="mt-6" data-testid="playground-citations">
          <h3 className="text-sm font-semibold text-foreground" id="playground-citations-title">{copy.citations}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{copy.citationCaveat}</p>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {generation.citations.map((citation) => {
              const pages = pageRef(citation.pageNumbers, units);
              return (
                <li className="flex min-w-0 items-center gap-3 px-3 py-2.5" key={citation.citationId}>
                  <CitationChip citation={citation} copy={copy} source={source} />
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{chunkTitle(citation.chunkId, run.stageResults) ?? citation.quote ?? copy.sourceDocument}</span>
                  {pages ? <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{pages}</span> : null}
                  <StatusIcon icon={citation.valid ? undefined : "warning"} label={citation.valid ? copy.citationValid : copy.citationCheck} tone={citation.valid ? "neutral" : "error"} />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function ExperimentErrorSurface({ copy, error }: { copy: RetrievalCopy; error: { code?: string | null; message?: string | null } | null }) {
  if (error?.code === "run_poll_timeout") {
    return <section className="mt-6 rounded-lg border border-warning-border bg-warning-subtle p-4 text-sm text-warning" data-testid="playground-tracking-paused" role="status">{copy.trackingPaused}</section>;
  }
  return (
    <section aria-live="assertive" className="mt-6 rounded-lg border border-destructive-border bg-destructive-panel p-5" data-testid="playground-error" role="alert">
      <h2 className="text-base font-semibold text-destructive">{copy.errorTitle}</h2>
      <p className="mt-1 text-sm text-destructive">{copy.errorBody}</p>
      {error?.code || error?.message ? <TechnicalDetails className="mt-3" summaryClassName="text-destructive hover:text-destructive"><dl className="grid gap-1 text-xs text-muted-foreground"><div><dt className="inline font-medium">{copy.errorCode}: </dt><dd className="inline font-mono">{error.code || "—"}</dd></div><div><dt className="inline font-medium">{copy.errorMessage}: </dt><dd className="inline break-words">{error.message || "—"}</dd></div></dl></TechnicalDetails> : null}
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex justify-between gap-3"><dt>{label}</dt><dd className="text-right text-foreground tabular-nums">{children}</dd></div>;
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
    <Disclosure className="mt-6" contentClassName="grid gap-5 p-4 text-xs sm:grid-cols-2" data-testid="playground-details" title={copy.details}>
      <section>
        <h3 className="font-semibold text-foreground">{copy.configuration}</h3>
        <dl className="mt-2 grid gap-1.5 text-muted-foreground">
          <DetailRow label={copy.mode}>{modeLabel(experimentRetrievalMode(run.config), copy)}</DetailRow>
          <DetailRow label={copy.topK}>{String(retrieval.topK ?? "—")}</DetailRow>
          <DetailRow label={copy.reranker}>{rerankerOn ? copy.on : copy.off}</DetailRow>
          {rerankerOn ? <DetailRow label={copy.candidateCount}>{String(reranking.candidateCount ?? "—")}</DetailRow> : null}
          <DetailRow label={copy.targetStage}>{copy.stages[run.targetStage]}</DetailRow>
          <DetailRow label={copy.tokenBudget}>{typeof context.tokenBudget === "number" ? formatNumber(locale, context.tokenBudget) : "—"}</DetailRow>
          <DetailRow label={copy.temperature}>{String(generation.temperature ?? "—")}</DetailRow>
        </dl>
      </section>
      <section>
        <h3 className="font-semibold text-foreground">{copy.provenance}</h3>
        <dl className="mt-2 grid gap-1.5 text-muted-foreground">
          <DetailRow label={copy.lineageStatus}>{run.historicalLineage ? copy.historicalRun : copy.currentPipeline}</DetailRow>
          <DetailRow label={copy.duration}>{formatMs(locale, run.timing.durationMs)}</DetailRow>
          {typeof run.queueDurationMs === "number" ? <DetailRow label={copy.queue}>{formatMs(locale, run.queueDurationMs)}</DetailRow> : null}
          <DetailRow label={copy.reuse}>{run.reusedExperiment ? copy.reused : copy.executed}</DetailRow>
          {timings ? (Object.keys(copy.timings) as Array<keyof RetrievalCopy["timings"]>).map((key) => <DetailRow key={key} label={copy.timings[key]}>{formatMs(locale, timings[key])}</DetailRow>) : null}
        </dl>
        <TechnicalDetails className="mt-3" title={copy.identifiers}>
          <dl className="grid gap-1.5 break-all font-mono text-xs text-muted-foreground">
            <div><dt className="inline font-sans font-medium">{copy.document}: </dt><dd className="inline">{run.documentId}</dd></div>
            <div><dt className="inline font-sans font-medium">{copy.chunk}: </dt><dd className="inline">{run.chunkRunId}</dd></div>
            <div><dt className="inline font-sans font-medium">{copy.embedding}: </dt><dd className="inline">{run.embeddingRunId || "—"}</dd></div>
            <div><dt className="inline font-sans font-medium">{copy.fingerprint}: </dt><dd className="inline">{run.experimentFingerprint || "—"}</dd></div>
          </dl>
        </TechnicalDetails>
      </section>
      <section className="sm:col-span-2">
        <h3 className="font-semibold text-foreground">{copy.output}</h3>
        <dl className="mt-2 grid gap-1.5 text-muted-foreground sm:grid-cols-3 sm:gap-5">
          <DetailRow label={copy.result}>{outputResult}</DetailRow>
          <DetailRow label={copy.contextUsage}>{results.context ? interpolate(copy.tokenUsage, { used: formatNumber(locale, results.context.tokenCount), budget: formatNumber(locale, results.context.tokenBudget) }) : "—"}</DetailRow>
          <DetailRow label={copy.citations}>{results.generation ? formatNumber(locale, results.generation.citations.length) : "—"}</DetailRow>
        </dl>
      </section>
    </Disclosure>
  );
}

function TopKControl({ copy, onChange, value }: { copy: RetrievalCopy; onChange: (value: string) => void; value: string }) {
  const numericValue = Number(value);
  return (
    <div className="flex h-9 items-center rounded-md border border-input bg-card">
      <button aria-label={copy.decreaseTopK} className="grid h-full w-8 place-items-center text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:text-input" disabled={numericValue <= 3} onClick={() => onChange(String(Math.max(3, numericValue - 1)))} type="button"><AppIcon name="minus" className="size-3.5" /></button>
      <Select onValueChange={onChange} value={value}>
        <SelectTrigger aria-label={copy.topK} className="h-8 w-8 justify-center border-0 bg-transparent px-0 text-sm shadow-none ring-0 tabular-nums [&>svg]:hidden">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {["3", "4", "5", "6", "7", "8", "9", "10"].map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
        </SelectContent>
      </Select>
      <button aria-label={copy.increaseTopK} className="grid h-full w-8 place-items-center text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:text-input" disabled={numericValue >= 10} onClick={() => onChange(String(Math.min(10, numericValue + 1)))} type="button"><AppIcon name="plus" className="size-3.5" /></button>
    </div>
  );
}

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
  const questionRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const clearCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => clearCleanup.current?.(), []);
  const selectedSample = sampleForHash(activeDocument?.sha256);

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

  async function copyTrace() {
    setCopyStatus("idle");
    try {
      await navigator.clipboard.writeText(JSON.stringify(experimentRun, null, 2));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

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
    processing: experimentStatus === "processing",
  });
  const canAsk = availability.allowed && question.trim().length > 0;
  const disabledReason = !availability.allowed ? availability.message : question.trim() ? "" : copy.enterQuestion;
  const showBlocker = !availability.allowed && availability.code !== "loading" && availability.code !== "processing";
  const results = experimentRun?.stageResults;
  const hasRunError = Boolean(experimentError || experimentRun?.status === "failed");
  const savedRunMatches = experimentRun ? savedRunMatchesDraft(experimentRun, { question, topK, mode, rerankerEnabled, candidateCount, tokenBudget, temperature, targetStage }) : false;
  const canContinue = Boolean(experimentRun && experimentRun.status === "completed" && experimentRun.targetStage !== "generation" && experimentStatus !== "processing");
  const canRerunGeneration = Boolean(experimentRun && experimentRun.status === "completed" && results?.generation && experimentStatus !== "processing");
  const answered = Boolean(experimentRun?.status === "completed" && results?.generation && generationOutcome(results.generation) === "answered");
  const selectedComparisonRuns = useMemo(() => experimentHistory.filter((run): run is ExperimentRun => compareIds.includes(run.id) && isExperimentDetail(run)), [compareIds, experimentHistory]);
  const historyPosition = (runId: string) => {
    const index = experimentHistory.findIndex((run) => run.id === runId);
    return index < 0 ? 1 : experimentHistory.length - index;
  };
  const experimentName = (run: { id: string; runNumber?: number | null }) => runName(allCopy, "experiment", run.runNumber ?? historyPosition(run.id));
  const source: SourceContext = { documentId: activeDocument?.id ?? null, parseResult };

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
    <div className="min-w-0 bg-background" data-testid="playground-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <PageHeader
          data-testid="playground-page-header"
          description={copy.description}
          help={preferences.showLearningHints ? <div data-testid="playground-question-help"><HowItWorks>{copy.howItWorks}</HowItWorks></div> : null}
          title={copy.title}
        />

        <section aria-label={copy.title} className="mt-6 rounded-lg border border-border bg-card p-3" data-testid="playground-input">
          <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <div className="flex items-center gap-3 max-md:flex-col max-md:items-stretch">
              <div className="t-clear steplab-clear relative min-w-0 flex-1" ref={questionRef}>
                <label className="sr-only" htmlFor="retrieval-question">{copy.question}</label>
                <textarea aria-keyshortcuts="Control+Enter Meta+Enter" aria-label={copy.question} className="block h-15 w-full resize-none rounded-md border-0 px-3 py-2 text-base leading-6 text-foreground outline-none placeholder:text-subtle-foreground" data-testid="playground-question" id="retrieval-question" onChange={(event) => { clearCleanup.current?.(); setQuestion(event.target.value); }} onKeyDown={handleQuestionKeyDown} placeholder={copy.placeholder} ref={textareaRef} value={question} />
                <div aria-hidden="true" className="t-clear-mirror" /><div aria-hidden="true" className="t-clear-glow" />
                {question ? <div className="absolute right-1.5 top-1.5"><Button aria-label={copy.clearQuestion} onClick={clearQuestion} size="icon-sm" type="button" variant="ghost"><AppIcon name="close" className="size-3.5" /></Button></div> : null}
              </div>
              <Button aria-busy={experimentStatus === "processing"} aria-describedby={!canAsk ? "ask-disabled-reason" : undefined} className="min-w-[164px] max-md:w-full" data-testid="playground-run-cta" disabled={!canAsk} size="lg" title={copy.runShortcut} type="submit">
                <AppIcon name="generate" className="size-4" />{copy.run}
              </Button>
            </div>
            {!canAsk && disabledReason ? <span className="sr-only" id="ask-disabled-reason">{disabledReason}</span> : null}
          </form>

          {selectedSample ? <div className="mx-3 mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3" data-testid="sample-questions">
            <span className="mr-1 text-xs font-medium text-muted-foreground">{copy.sampleQuestions}</span>
            {selectedSample.questions.map((suggestion) => <button className="rounded-full border border-border px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-secondary" key={suggestion} onClick={() => setQuestion(suggestion)} type="button">{suggestion}</button>)}
          </div> : null}

          <div className="mt-3 grid grid-cols-[max-content_max-content_max-content] items-end gap-3 border-t border-border px-3 pt-3 max-sm:grid-cols-2" data-testid="playground-primary-controls">
            <fieldset className="min-w-0 max-sm:col-span-2">
              <legend className="mb-1.5 block text-xs font-medium text-muted-foreground">{copy.retrieval}</legend>
              <div aria-label={copy.mode} className="flex h-9 min-w-0 items-center rounded-md border border-border bg-secondary p-1 max-sm:w-full" data-testid="playground-mode-control" role="group">
                {(["dense", "hybrid", "keyword"] as const).map((value) => <button aria-pressed={mode === value} className={mode === value ? "h-full rounded-sm bg-card px-3 text-xs font-medium text-foreground shadow-sm max-sm:flex-1" : "h-full rounded-sm px-2.5 text-xs font-medium text-muted-foreground hover:bg-card/70 max-sm:flex-1"} key={value} onClick={() => setMode(value)} type="button">{copy.modes[value]}</button>)}
              </div>
            </fieldset>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{copy.topK}</span>
              <div data-testid="playground-top-k-control"><TopKControl copy={copy} onChange={setTopK} value={topK} /></div>
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{copy.reranker}</span>
              <label className="flex h-9 min-w-[108px] items-center justify-between gap-3 rounded-md border border-input bg-card pl-3 pr-1 text-xs font-medium text-muted-foreground" data-testid="playground-reranker-control" htmlFor="reranker-enabled">
                <span>{rerankerEnabled ? copy.on : copy.off}</span>
                <Switch aria-label={copy.reranker} checked={rerankerEnabled} className="h-9" id="reranker-enabled" onCheckedChange={setRerankerEnabled} />
              </label>
            </div>
          </div>

          <div className="mx-3 mt-3" data-testid="playground-utilities">
            <Disclosure data-testid="playground-advanced" title={copy.advanced} variant="inline">
              <div className="grid gap-3 pt-1 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs font-medium text-foreground" htmlFor="target-stage">{copy.targetStage}<Select onValueChange={(value) => setTargetStage(value as ExperimentTargetStage)} value={targetStage}><SelectTrigger className="mt-1.5" id="target-stage"><SelectValue /></SelectTrigger><SelectContent>{STAGES.map((stage) => <SelectItem key={stage} value={stage}>{copy.stages[stage]}</SelectItem>)}</SelectContent></Select></label>
                {/* The candidate count only means something when the reranker runs. */}
                {rerankerEnabled ? <label className="text-xs font-medium text-foreground" htmlFor="candidate-count">{copy.candidateCount}<Input className="mt-1.5 tabular-nums" id="candidate-count" max={Math.max(20, Number(topK) * 4)} min={Number(topK)} onChange={(event) => setCandidateCount(Number(event.target.value))} type="number" value={candidateCount} /></label> : null}
                <label className="text-xs font-medium text-foreground" htmlFor="context-budget">{copy.tokenBudget}<Input className="mt-1.5 tabular-nums" id="context-budget" max={12000} min={256} onChange={(event) => setTokenBudget(Number(event.target.value))} type="number" value={tokenBudget} /></label>
                <label className="text-xs font-medium text-foreground" htmlFor="generation-temperature">{copy.temperature}<Input className="mt-1.5 tabular-nums" id="generation-temperature" max={2} min={0} onChange={(event) => setTemperature(Number(event.target.value))} step="0.1" type="number" value={temperature} /></label>
              </div>
              <div className="mt-3"><Button aria-describedby={!hasChanges ? "retrieval-reset-disabled-reason" : undefined} disabled={!hasChanges} onClick={reset} size="sm" variant="ghost"><AppIcon name="reset" className="size-4" />{copy.reset}</Button></div>
              {!hasChanges ? <span className="sr-only" id="retrieval-reset-disabled-reason">{copy.nothingToReset}</span> : null}
            </Disclosure>
          </div>

          {!hasRunError && experimentStatus === "processing" ? <p className="mx-3 mt-3 flex items-center gap-2 text-xs text-muted-foreground" data-testid="playground-run-state" role="status"><AppIcon name="loading" className="size-3.5 animate-spin motion-reduce:animate-none" /><ThinkingText>{copy.running}</ThinkingText></p> : null}
          {!hasRunError && experimentStatus !== "processing" && experimentRun?.status === "completed" && !savedRunMatches ? <p className="mx-3 mt-3 flex items-center gap-2 text-xs text-warning" data-testid="playground-run-state" role="status"><span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />{copy.settingsChanged}</p> : null}
        </section>

        <StageBlocker blocker={showBlocker ? availability : null} className="mt-4" data-testid="playground-blocker" />
        {hasRunError ? <ExperimentErrorSurface copy={copy} error={experimentError} /> : null}
        {!experimentRun && !hasRunError && availability.code === "loading" ? <Skeleton className="mt-5" label={copy.loading} rows={3} /> : null}
        {!experimentRun && !hasRunError && availability.allowed ? <EmptyState className="mt-5 min-h-[210px] rounded-lg border border-border bg-card" description={copy.readyDescription} icon="retrieve" title={copy.readyTitle} titleAs="h2" /> : null}

        {experimentRun ? <>
          <p className="mt-7 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums" data-testid="playground-result-meta">
            <span className="font-medium text-foreground">{experimentName(experimentRun)}</span>
            {runDate(experimentRun, locale, "medium") ? <span>· {runDate(experimentRun, locale, "medium")}</span> : null}
            {experimentRun.reusedExperiment ? <span className="inline-flex items-center gap-1" title={copy.reusedHint}>· <AppIcon name="history" className="size-3.5" />{copy.reused}<span className="sr-only">. {copy.reusedHint}</span></span> : null}
          </p>
          <div className="mt-3 grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]" data-testid="playground-stage-layout">
            <aside aria-labelledby="playground-stages-title" className="min-w-0" data-testid="playground-stage-rail">
              <h2 className="text-sm font-medium text-muted-foreground" id="playground-stages-title">{copy.stagesTitle}</h2>
              <div className="mt-2 rounded-lg border border-border bg-card p-1.5 lg:p-2"><ExperimentStageTrace activeStage={activeStage} copy={copy} locale={locale} onSelect={setActiveStage} run={experimentRun} /></div>
            </aside>

            <TransitionPanel as="section" className="min-w-0" data-testid="playground-stage-content" transitionKey={`${experimentRun.id}:${activeStage}:${results?.[activeStage]?.durationMs}`}>
              {activeStage === "retrieval" ? <RetrievalStageView copy={copy} locale={locale} run={experimentRun} source={source} /> : null}
              {activeStage === "reranking" ? <RerankingStageView copy={copy} locale={locale} run={experimentRun} source={source} /> : null}
              {activeStage === "context" ? <ContextStageView copy={copy} locale={locale} run={experimentRun} /> : null}
              {activeStage === "generation" ? <AnswerStageView copy={copy} locale={locale} run={experimentRun} source={source} /> : null}
            </TransitionPanel>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4" data-testid="playground-current-actions">
            {(experimentRun.status === "queued" || experimentRun.status === "running") && experimentStatus !== "processing" ? <Button onClick={() => void resumeRunTracking("experiment")} size="sm" variant="outline">{copy.resumeTracking}</Button> : null}
            {canContinue ? <Button onClick={() => void continueExperiment()} size="sm" variant="outline">{copy.runNextStage}</Button> : null}
            {results?.generation ? <Button disabled={!canRerunGeneration} onClick={() => void rerunGeneration()} size="sm" variant="outline">{copy.regenerate}</Button> : null}
            <Button onClick={() => void copyTrace()} size="sm" variant="outline"><AppIcon name="copy" className="size-4" />{copy.copyTrace}</Button>
            {copyStatus !== "idle" ? <span className="text-xs text-muted-foreground" role="status"><TransitionText>{copyStatus === "copied" ? copy.traceCopied : copy.copyFailed}</TransitionText></span> : null}
            {answered ? <Link className="ml-auto inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline max-sm:ml-0" data-testid="playground-continue-evaluation" href="/evaluation">{allCopy.overview.continuation.evaluation}<AppIcon name="arrowRight" className="size-3.5" /></Link> : null}
          </div>

          {experimentRun.status === "completed" || experimentRun.status === "failed" ? <ExperimentDetails copy={copy} locale={locale} run={experimentRun} /> : null}
        </> : null}

        {experimentHistory.length ? (
          <Disclosure className="mt-6" contentClassName="p-0" data-testid="playground-history" meta={formatNumber(locale, experimentHistory.length)} title={copy.history}>
            <ul className="divide-y divide-border">
              {experimentHistory.map((run) => {
                const name = experimentName(run);
                const meta = [modeLabel(experimentRetrievalMode(run.config), copy), interpolate(copy.topKValue, { k: String(objectValue(run.config.retrieval).topK ?? "—") }), runDate(run, locale, "short")].filter(Boolean).join(" · ");
                return (
                  <li className="flex min-w-0 items-center gap-3 px-4 py-2.5" key={run.id}>
                    <TransitionCheckbox aria-label={interpolate(copy.compareRun, { name })} checked={compareIds.includes(run.id)} disabled={!compareIds.includes(run.id) && compareIds.length >= 2} onChange={() => toggleCompare(run.id)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{run.query || name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground tabular-nums">{meta}</p>
                    </div>
                    <Button aria-label={interpolate(copy.loadRun, { name })} onClick={() => loadHistoryRun(run)} size="sm" variant="ghost">{copy.load}</Button>
                  </li>
                );
              })}
            </ul>
            {selectedComparisonRuns.length ? (
              <div className="grid gap-3 border-t border-border p-4 md:grid-cols-2" data-testid="playground-history-compare">
                <p className="sr-only">{interpolate(copy.selectedRuns, { count: compareIds.length })}</p>
                {selectedComparisonRuns.map((run) => (
                  <div className="min-w-0" key={run.id}>
                    <p className="text-xs font-semibold text-foreground">{experimentName(run)}</p>
                    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <div><dt className="text-subtle-foreground">{copy.mode}</dt><dd className="mt-1">{modeLabel(experimentRetrievalMode(run.config), copy)}</dd></div>
                      <div><dt className="text-subtle-foreground">{copy.candidates}</dt><dd className="mt-1 tabular-nums">{formatNumber(locale, (run.stageResults.retrieval?.results ?? run.stageResults.retrieval?.candidates ?? []).length)}</dd></div>
                      <div><dt className="text-subtle-foreground">{copy.validCitations}</dt><dd className="mt-1 tabular-nums">{formatNumber(locale, run.stageResults.generation?.citations.filter((citation) => citation.valid).length ?? 0)}</dd></div>
                      <div><dt className="text-subtle-foreground">{copy.duration}</dt><dd className="mt-1 tabular-nums">{formatMs(locale, run.timing.durationMs)}</dd></div>
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
