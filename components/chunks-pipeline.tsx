"use client";

import { SlidingTabs, ThinkingText, TransitionNumber, TransitionPanel, TransitionText } from "@/components/ui/transitions";

import { useEffect, useState } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { hasVisibleBlocker, PipelineErrorMessage, StageBlockerRow } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { TechnicalDetails } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { type AppCopy, interpolate, runName, useCopy } from "@/lib/copy";
import type { ChunkItem, ChunkRun, ChunkStrategy, EmbeddingRun } from "@/lib/rag-api-types";
import { getPipelineAvailability } from "@/lib/blockers";
import { splitChunkText } from "@/lib/chunk-text";
import { formatCount, formatNumber } from "@/lib/format";
import { chunkFormConfigFromRun, chunkStageState, completedCompatibleRun, type ChunkStageState } from "@/lib/pipeline-lineage";
import { cn } from "@/lib/utils";

const STRATEGIES: ChunkStrategy[] = ["fixed_token", "recursive_token", "structure_aware"];

/** Chunk text with Markdown pipe tables rendered as plain-text table cells (never HTML). */
export function ChunkText({ text }: { text: string }) {
  const blocks = splitChunkText(text);
  return (
    <div className="space-y-4 text-sm leading-6 text-foreground" data-testid="chunk-text">
      {blocks.map((block, index) => block.type === "table" ? (
        <div className="max-w-full overflow-x-auto rounded-md border border-border" key={index}>
          <table className="min-w-full text-left text-sm">
            <thead className="bg-technical">
              <tr>{block.header.map((cell, cellIndex) => <th className="border-b border-border px-3 py-2 font-medium" key={cellIndex} scope="col">{cell}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr className="border-b border-border last:border-b-0" key={rowIndex}>
                  {row.map((cell, cellIndex) => <td className="px-3 py-2 align-top" key={cellIndex}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="whitespace-pre-wrap break-words" key={index}>{block.text}</p>)}
    </div>
  );
}

function pageLabel(copy: AppCopy, chunk: ChunkItem) {
  return chunk.pageNumbers.length ? `${copy.units.pageShort} ${chunk.pageNumbers.join(", ")}` : copy.chunking.inspector.noPage;
}

function ChunkInspector({ run, documentId, parseResult }: { run: ChunkRun; documentId: string | null; parseResult: Parameters<typeof SourceInspector>[0]["parseResult"] }) {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const labels = copy.chunking.inspector;
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(run.chunks[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const selectedChunk = run.chunks.find((chunk) => chunk.id === selectedChunkId) ?? run.chunks[0];
  if (!selectedChunk) return <EmptyState className="rounded-lg border border-border bg-card" icon="chunk" title={labels.empty} />;

  const normalizedQuery = query.trim().toLowerCase();
  const visibleChunks = run.chunks.filter((chunk) => !normalizedQuery || `${chunk.ordinal + 1} ${chunk.text} ${chunk.headingPath.join(" ")}`.toLowerCase().includes(normalizedQuery));

  return (
    <div className="grid min-w-0 overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[360px_minmax(0,1fr)]" data-testid="chunk-inspector">
      <aside className="min-w-0 border-b border-border lg:border-b-0 lg:border-r">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">{labels.list} <span className="font-normal text-subtle-foreground tabular-nums">· {formatNumber(preferences.locale, run.chunkCount)}</span></p>
          <div className="relative mt-2.5"><AppIcon name="retrieve" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" /><Input aria-label={labels.filter} className="pl-9" data-testid="chunk-filter" onChange={(event) => setQuery(event.target.value)} placeholder={labels.filterPlaceholder} value={query} /></div>
        </div>
        <div className="max-h-[620px] overflow-y-auto" role="list" aria-label={labels.list}>
          {visibleChunks.length ? visibleChunks.map((chunk) => {
            const selected = chunk.id === selectedChunk.id;
            const displayOrdinal = chunk.ordinal + 1;
            const parents = chunk.headingPath.slice(0, -1).join(" › ");
            return (
              <button aria-pressed={selected} className={cn("block min-h-15 w-full border-l-2 px-4 py-2.5 text-left transition-colors", selected ? "border-brand bg-secondary" : "border-transparent hover:bg-surface-subtle")} data-testid="chunk-list-item" key={chunk.id} onClick={() => setSelectedChunkId(chunk.id)} type="button">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground"><span className="mr-2 text-subtle-foreground tabular-nums">{String(displayOrdinal).padStart(2, "0")}</span>{chunk.headingPath.at(-1) || `${labels.chunk} ${displayOrdinal}`}</span>
                  <span className="shrink-0 text-xs text-subtle-foreground tabular-nums" title={formatCount(preferences.locale, chunk.tokenCount, copy.units.token)}>{formatNumber(preferences.locale, chunk.tokenCount)}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-subtle-foreground">{[parents, pageLabel(copy, chunk)].filter(Boolean).join(" · ")}</span>
              </button>
            );
          }) : <p className="px-4 py-6 text-center text-xs leading-5 text-muted-foreground">{labels.noMatches}</p>}
        </div>
      </aside>
      <TransitionPanel as="article" transitionKey={`${run.id}:${selectedChunk.id}`} className="min-w-0" data-testid="chunk-inspector-detail">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <span className="inline-flex rounded-sm bg-secondary px-2 py-1 text-xs font-medium text-foreground tabular-nums">{labels.chunk} {selectedChunk.ordinal + 1}</span>
            {selectedChunk.headingPath.length ? <p className="mt-2 text-xs text-subtle-foreground">{selectedChunk.headingPath.join(" › ")}</p> : null}
          </div>
          <SourceInspector documentId={documentId} headingPath={selectedChunk.headingPath} pageNumbers={selectedChunk.pageNumbers} parseResult={parseResult} sourceElementIds={selectedChunk.sourceElementIds} triggerLabel={labels.viewSource} />
        </div>
        <div className="p-6">
          <p className="flex flex-wrap gap-x-2 text-xs text-subtle-foreground tabular-nums">
            <span>{formatCount(preferences.locale, selectedChunk.tokenCount, copy.units.token)}</span>
            <span aria-hidden="true">·</span>
            <span>{pageLabel(copy, selectedChunk)}</span>
            <span aria-hidden="true">·</span>
            <span>{formatCount(preferences.locale, selectedChunk.sourceElementIds.length, copy.units.element)}</span>
          </p>
          <div className="mt-5 border-t border-border pt-5">{selectedChunk.text.trim() ? <ChunkText text={selectedChunk.text} /> : <p className="text-sm text-muted-foreground">—</p>}</div>
          <TechnicalDetails className="mt-6 border-t border-border pt-4" data-testid="chunk-technical-details">
            <dl className="grid gap-3 text-xs">
              <div className="min-w-0">
                <dt className="text-subtle-foreground">{labels.sourceElements}</dt>
                <dd className="mt-1 flex min-w-0 flex-wrap gap-1.5">{selectedChunk.sourceElementIds.length
                  ? selectedChunk.sourceElementIds.map((id) => <code className="min-w-0 max-w-full rounded-sm bg-secondary px-1.5 py-0.5 font-mono text-foreground [overflow-wrap:anywhere]" key={id}>{id}</code>)
                  : <span className="text-muted-foreground">—</span>}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-subtle-foreground">{labels.chunkId}</dt>
                <dd className="mt-1 font-mono text-foreground [overflow-wrap:anywhere]">{selectedChunk.id}</dd>
              </div>
            </dl>
          </TechnicalDetails>
        </div>
      </TransitionPanel>
    </div>
  );
}

function EmbeddingLineage({ chunkCount, run }: { chunkCount: number | null; run: EmbeddingRun | null }) {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const count = chunkCount ?? run?.embeddingCount ?? null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="embedding-lineage">
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground tabular-nums" data-testid="embedding-primary-result">
        <AppIcon name="chunk" className="size-4 shrink-0 text-muted-foreground" />
        {count === null ? "—" : <><TransitionNumber>{formatNumber(preferences.locale, count)}</TransitionNumber> {formatCount(preferences.locale, count, copy.units.chunk).split(" ").slice(1).join(" ")}</>}
      </p>
      <AppIcon aria-hidden="true" name="arrowRight" className="size-4 shrink-0 text-subtle-foreground" />
      <p className={cn("flex min-w-0 items-center gap-2 text-sm tabular-nums", run ? "font-semibold text-foreground" : "text-muted-foreground")} data-testid="embedding-output-result">
        <AppIcon name="embed" className={cn("size-4 shrink-0", run ? "text-foreground" : "text-muted-foreground")} />
        {run ? <><TransitionNumber>{formatNumber(preferences.locale, run.embeddingCount)}</TransitionNumber> {formatCount(preferences.locale, run.embeddingCount, copy.units.vector).split(" ").slice(1).join(" ")}</> : copy.embeddings.pending}
      </p>
    </div>
  );
}

export type PipelineStage = "chunking" | "embeddings";

export function ChunkingWorkspace({ onFormStateChange }: { onFormStateChange?: (state: ChunkStageState) => void }) {
  return <ChunksPipeline onFormStateChange={onFormStateChange} stage="chunking" />;
}

export function EmbeddingWorkspace({ showAction = true }: { showAction?: boolean }) {
  return <ChunksPipeline showAction={showAction} stage="embeddings" />;
}

export function ChunksPipeline({ showAction = true, stage, onFormStateChange }: { showAction?: boolean; stage: PipelineStage; onFormStateChange?: (state: ChunkStageState) => void }) {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const { activeDocument, activePipeline, selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId, selectedParseResult, selectedChunkRun, persistenceStatus, workspaceStatus, chunkStatus, chunkRun, chunkError, embeddingStatus, embeddingRun, embeddingError, runChunking, runEmbedding } = useDocumentPipeline();
  const selectedChunkSummary = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId) ?? null;
  // The form starts from the selected chunk run so it describes the result on screen.
  const initialForm = chunkFormConfigFromRun(selectedChunkSummary);
  const [strategy, setStrategy] = useState<ChunkStrategy>(initialForm.strategy);
  const [chunkSize, setChunkSize] = useState(initialForm.config.chunkSizeTokens);
  const [overlap, setOverlap] = useState(initialForm.config.overlapTokens);
  const [formSourceRunId, setFormSourceRunId] = useState(selectedChunkSummary?.id ?? null);
  if ((selectedChunkSummary?.id ?? null) !== formSourceRunId) {
    setFormSourceRunId(selectedChunkSummary?.id ?? null);
    setStrategy(initialForm.strategy);
    setChunkSize(initialForm.config.chunkSizeTokens);
    setOverlap(initialForm.config.overlapTokens);
  }
  /** isUpToDate: the selected lineage already has a chunk run for this exact config (re-running is optional). */
  const chunkFormState = chunkStageState(selectedChunkSummary, selectedParseRunId, { strategy, config: { chunkSizeTokens: chunkSize, overlapTokens: overlap } });
  const { isDirty: formDirty, isUpToDate: formUpToDate } = chunkFormState;
  useEffect(() => {
    onFormStateChange?.({ isDirty: formDirty, isUpToDate: formUpToDate });
  }, [formDirty, formUpToDate, onFormStateChange]);
  const [reuseNotice, setReuseNotice] = useState<"chunk" | "embedding" | null>(null);
  const compatibleChunkRuns = activeDocument?.chunkRuns.filter((run) => run.status === "completed" && run.isCompatible && run.upstream.parseRunId === selectedParseRunId) ?? [];
  const selectedParseSummary = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId) ?? null;
  const selectedEmbeddingSummary = activeDocument?.embeddingRuns.find((run) => run.id === selectedEmbeddingRunId) ?? null;
  const chunkAvailability = getPipelineAvailability(locale, "chunk", {
    document: activeDocument,
    pipeline: activePipeline,
    selection: { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId },
    parseRun: selectedParseSummary,
    processing: chunkStatus === "processing",
    persistenceStatus,
    workspaceStatus,
  });
  const embeddingAvailability = getPipelineAvailability(locale, "embedding", {
    document: activeDocument,
    pipeline: activePipeline,
    selection: { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId },
    parseRun: selectedParseSummary,
    chunkRun: selectedChunkSummary,
    processing: embeddingStatus === "processing",
    persistenceStatus,
    workspaceStatus,
  });
  const canChunk = chunkAvailability.allowed;
  const canEmbed = embeddingAvailability.allowed && compatibleChunkRuns.some((run) => run.id === selectedChunkRunId);
  // A current embedding for the selected chunks makes re-creating it optional.
  const embeddingUpToDate = Boolean(selectedEmbeddingSummary && completedCompatibleRun(selectedEmbeddingSummary) && selectedEmbeddingSummary.upstream.chunkRunId === selectedChunkRunId);
  // Embeddings are always built from the selected chunk run, never an inspected one.
  const selectedChunkCount = selectedChunkRun?.chunkCount ?? selectedChunkSummary?.chunkCount ?? null;
  // Source evidence is only resolvable against the parse run the viewed chunks came from.
  const chunkParseResult = chunkRun && selectedParseResult?.parseRunId === chunkRun.parseRunId ? selectedParseResult : null;
  const chunks = chunkRun?.chunks ?? [];
  const tokenCounts = chunks.map((chunk) => chunk.tokenCount);
  const averageTokens = tokenCounts.length ? Math.round(tokenCounts.reduce((sum, value) => sum + value, 0) / tokenCounts.length) : null;
  const minTokens = tokenCounts.length ? Math.min(...tokenCounts) : null;
  const maxTokens = tokenCounts.length ? Math.max(...tokenCounts) : null;

  async function handleChunk() {
    const result = await runChunking(strategy, { chunkSizeTokens: chunkSize, overlapTokens: overlap });
    setReuseNotice(result?.reusedArtifact ? "chunk" : null);
  }
  async function handleEmbedding() {
    const result = await runEmbedding();
    setReuseNotice(result?.reusedArtifact ? "embedding" : null);
  }

  if (stage === "embeddings") {
    const sourceChunkRunId = embeddingRun?.chunkRunId ?? embeddingRun?.upstream.chunkRunId ?? null;
    const sourceChunkRun = sourceChunkRunId ? activeDocument?.chunkRuns.find((run) => run.id === sourceChunkRunId) : undefined;
    const embeddingBlocker = !canEmbed && embeddingStatus !== "processing" ? embeddingAvailability : null;
    const describedBy = [hasVisibleBlocker(embeddingBlocker) ? "embedding-run-disabled-reason" : null, embeddingUpToDate ? "embedding-run-hint" : null].filter(Boolean).join(" ") || undefined;
    return (
      <div className="mt-6" data-testid="embeddings-workspace">
        <section className="w-full max-w-[760px] rounded-lg border border-border bg-card p-4 sm:w-fit" data-testid="embedding-action-card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            {showAction ? <div className="min-w-0 shrink-0">
              <Button aria-busy={embeddingStatus === "processing"} aria-describedby={describedBy} data-testid="embedding-run-action" disabled={!canEmbed} onClick={() => void handleEmbedding()} title={embeddingUpToDate ? copy.embeddings.createHint : undefined} variant={embeddingUpToDate ? "outline" : "default"}>
                <AppIcon name={embeddingStatus === "processing" ? "loading" : "play"} className={embeddingStatus === "processing" ? "size-3.5 animate-spin motion-reduce:animate-none" : "size-3.5"} />
                <TransitionText>{embeddingStatus === "processing" ? copy.embeddings.creating : copy.embeddings.create}</TransitionText>
              </Button>
              {embeddingUpToDate ? <span className="sr-only" id="embedding-run-hint">{copy.embeddings.createHint}</span> : null}
            </div> : null}
            <div className="min-w-0 flex-1 sm:border-l sm:border-border sm:pl-5"><EmbeddingLineage chunkCount={selectedChunkCount} run={embeddingRun} /></div>
          </div>
          <StageBlockerRow blocker={embeddingBlocker} className="mt-3" id="embedding-run-disabled-reason" kind="embedding" testId="embedding-blocker" />
        </section>
        {embeddingStatus === "processing" ? (
          <div className="mt-4 max-w-[760px] rounded-md border border-border bg-card p-4 text-xs text-muted-foreground" role="status">
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full w-1/3 animate-pulse rounded-full bg-muted-foreground" /></div>
            <p className="mt-2"><span className="tabular-nums">{selectedChunkCount === null ? "—" : formatCount(locale, selectedChunkCount, copy.units.chunk)}</span> · <ThinkingText>{copy.embeddings.progress}</ThinkingText></p>
          </div>
        ) : null}
        <div className="mt-3 max-w-[760px]"><PipelineErrorMessage message={embeddingError?.message} /></div>
        {reuseNotice === "embedding" ? <p className="mt-4 max-w-[760px] rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs text-muted-foreground" data-testid="embedding-reuse-notice" role="status"><AppIcon name="completed" className="mr-1 inline size-3.5" />{copy.embeddings.reuseNotice}</p> : null}
        {embeddingRun ? (
          <section className="mt-5" data-testid="embedding-result-details">
            <p className="text-sm text-muted-foreground">
              {copy.embeddings.model} <span className="font-medium text-foreground">{embeddingRun.model || "Gemini Embedding"}</span>
              <span aria-hidden="true"> · </span>
              <span className="tabular-nums">{formatCount(locale, embeddingRun.dimensions, copy.units.dimension)}</span>
            </p>
            <TechnicalDetails className="mt-2" data-testid="embedding-details">
              <dl className="grid gap-3 text-xs sm:grid-cols-3">
                <div><dt className="text-subtle-foreground">{copy.embeddings.storage}</dt><dd className="mt-1 font-medium text-foreground">{copy.embeddings.stored}</dd></div>
                <div className="min-w-0"><dt className="text-subtle-foreground">{copy.embeddings.sourceChunks}</dt><dd className="mt-1 font-medium text-foreground">{sourceChunkRun ? runName(copy, "chunk", sourceChunkRun.runNumber) : <span className="font-mono [overflow-wrap:anywhere]">{sourceChunkRunId ?? "—"}</span>}</dd></div>
                <div className="min-w-0"><dt className="text-subtle-foreground">{copy.embeddings.format}</dt><dd className="mt-1 font-medium text-foreground [overflow-wrap:anywhere]">{embeddingRun.embeddingFormatVersion}</dd></div>
              </dl>
            </TechnicalDetails>
          </section>
        ) : null}
      </div>
    );
  }

  const labels = copy.chunking;
  const chunkSizeTokens = formatCount(locale, chunkSize, copy.units.token).split(" ").slice(1).join(" ");
  const overlapInvalid = overlap >= chunkSize;
  const runDescribedBy = [overlapInvalid ? "chunk-overlap-reason" : null, hasVisibleBlocker(canChunk ? null : chunkAvailability) ? "chunk-disabled-reason" : null, selectedChunkSummary ? "chunk-run-hint" : null].filter(Boolean).join(" ") || undefined;
  const selectedRunName = selectedChunkSummary ? runName(copy, "chunk", selectedChunkSummary.runNumber) : null;
  return (
    <div className="mt-6" data-testid="chunking-workspace">
      <section className="rounded-lg border border-border bg-card p-4" data-chunk-config-dirty={chunkFormState.isDirty} data-chunk-up-to-date={chunkFormState.isUpToDate} data-testid="chunking-config-card">
        <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)] xl:gap-0">
          <div className="min-w-0 xl:pr-5">
            <h2 className="text-base font-semibold text-foreground">{labels.strategy}</h2>
            <SlidingTabs value={strategy} aria-label={labels.strategy} className="mt-3 inline-flex max-w-full flex-wrap items-center gap-1 rounded-md border border-border bg-secondary p-1 [&>.t-tabs-pill]:shadow-sm [&>.t-tabs-pill]:ring-1 [&>.t-tabs-pill]:ring-border" role="radiogroup">
              {STRATEGIES.map((option) => {
                const selected = strategy === option;
                return (
                  <button aria-checked={selected} className={cn("h-8 rounded-sm px-3 text-sm font-medium transition-colors", selected ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/70 hover:text-foreground")} key={option} tabIndex={selected ? 0 : -1} onKeyDown={(event) => {
                    const offset = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                    if (!offset) return;
                    event.preventDefault();
                    const next = (STRATEGIES.indexOf(option) + offset + STRATEGIES.length) % STRATEGIES.length;
                    setStrategy(STRATEGIES[next]);
                    (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next])?.focus();
                  }} onClick={() => setStrategy(option)} role="radio" type="button">{labels.strategies[option]}</button>
                );
              })}
            </SlidingTabs>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{labels.strategyNotes[strategy]}</p>
          </div>
          <div className="min-w-0 border-t border-border pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
            <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] xl:max-w-[640px]" data-testid="chunk-compact-controls">
              <div className="min-w-0">
                <label className="flex items-center gap-1 text-xs font-medium text-foreground" htmlFor="chunk-size">{labels.chunkSize}<span className="text-subtle-foreground" title={labels.chunkSizeHint}><AppIcon aria-hidden="true" name="help" className="size-3.5" /></span></label>
                <span className="relative mt-1.5 block"><Input aria-describedby="chunk-size-hint" className="pr-14 tabular-nums" id="chunk-size" max={4096} min={32} onChange={(event) => setChunkSize(Number(event.target.value))} type="number" value={chunkSize} /><span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-subtle-foreground">{chunkSizeTokens}</span></span>
                <span className="sr-only" id="chunk-size-hint">{labels.chunkSizeHint}</span>
              </div>
              <div className="min-w-0">
                <label className="flex items-center gap-1 text-xs font-medium text-foreground" htmlFor="chunk-overlap">{labels.overlap}<span className="text-subtle-foreground" title={labels.overlapHint}><AppIcon aria-hidden="true" name="help" className="size-3.5" /></span></label>
                <span className="relative mt-1.5 block"><Input aria-describedby="chunk-overlap-hint" aria-invalid={overlapInvalid || undefined} className="pr-14 tabular-nums" id="chunk-overlap" max={1024} min={0} onChange={(event) => setOverlap(Number(event.target.value))} type="number" value={overlap} /><span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-subtle-foreground">{formatCount(locale, overlap, copy.units.token).split(" ").slice(1).join(" ")}</span></span>
                <span className="sr-only" id="chunk-overlap-hint">{labels.overlapHint}</span>
              </div>
              <Button aria-busy={chunkStatus === "processing"} aria-describedby={runDescribedBy} data-testid="chunking-run-action" disabled={!canChunk || overlapInvalid} onClick={() => void handleChunk()} title={selectedChunkSummary ? labels.runHint : undefined} variant={chunkFormState.isUpToDate ? "outline" : "default"}>
                <AppIcon name={chunkStatus === "processing" ? "loading" : "play"} className={chunkStatus === "processing" ? "size-3.5 animate-spin motion-reduce:animate-none" : "size-3.5"} />{chunkStatus === "processing" ? labels.running : labels.run}
              </Button>
            </div>
            {selectedChunkSummary ? <span className="sr-only" id="chunk-run-hint">{labels.runHint}</span> : null}
            {selectedRunName && chunkFormState.isDirty ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-state="dirty" data-testid="chunk-config-state"><span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />{interpolate(labels.changedFromRun, { run: selectedRunName })}</p>
            ) : selectedRunName && chunkFormState.isUpToDate ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" data-state="current" data-testid="chunk-config-state"><AppIcon aria-hidden="true" name="check" className="size-3.5" />{interpolate(labels.matchesRun, { run: selectedRunName })}</p>
            ) : null}
            <StageBlockerRow blocker={canChunk ? null : chunkAvailability} className="mt-2" id="chunk-disabled-reason" kind="chunk" testId="chunk-blocker" />
            {overlapInvalid ? <p className="mt-2 text-xs text-destructive" id="chunk-overlap-reason" role="alert">{labels.overlapError}</p> : null}
            <div className="mt-2"><PipelineErrorMessage message={chunkError?.message} /></div>
            {reuseNotice === "chunk" ? <p className="mt-3 rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs text-muted-foreground" data-testid="chunk-reuse-notice" role="status"><AppIcon name="completed" className="mr-1 inline size-3.5" />{labels.reuseNotice}</p> : null}
          </div>
        </div>
      </section>
      {chunkRun ? (
        <section className="mt-8" data-testid="chunk-results">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-3 sm:grid-cols-4">
            {([
              [labels.summary.chunks, chunkRun.chunkCount],
              [labels.summary.average, averageTokens],
              [labels.summary.min, minTokens],
              [labels.summary.max, maxTokens],
            ] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold text-foreground tabular-nums">{formatNumber(locale, value)}</dd></div>)}
          </dl>
          <div className="mt-7">
            <h2 className="text-base font-semibold">{labels.inspector.title}</h2>
            <div className="mt-4"><ChunkInspector documentId={activeDocument?.id ?? null} parseResult={chunkParseResult} run={chunkRun} /></div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
