"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { ApiErrorNotice } from "@/components/api-error-message";
import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { hasVisibleBlocker, StageBlockerRow } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TechnicalDetails } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { HintText, Label } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { Notice } from "@/components/ui/notice";
import { Panel } from "@/components/ui/panel";
import { ProgressBar } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SparkBarChart } from "@/components/ui/spark-chart";
import { StatusBadge } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toast";
import { InfoTip } from "@/components/ui/info-tip";
import { Tooltip } from "@/components/ui/tooltip";
import { TransitionNumber, TransitionPanel, TransitionText } from "@/components/ui/transitions";
import { apiErrorCode, isTrackingPaused } from "@/lib/api-errors";
import { type AppCopy, interpolate, runName, useCopy } from "@/lib/copy";
import type { ChunkItem, ChunkRun, ChunkStrategy, EmbeddingRun } from "@/lib/rag-api-types";
import { getPipelineAvailability } from "@/lib/blockers";
import { splitChunkText } from "@/lib/chunk-text";
import { formatCount, formatList, formatMs, formatNumber } from "@/lib/format";
import { chunkFormConfigFromRun, chunkStageState, completedCompatibleRun, type ChunkStageState } from "@/lib/pipeline-lineage";
import { cn } from "@/lib/utils";

const STRATEGIES: ChunkStrategy[] = ["fixed_token", "recursive_token", "structure_aware"];

/** Unit word of a count ("tokens" for 512), so numbers and units can be styled apart. */
function unitOf(locale: Parameters<typeof formatCount>[0], count: number, forms: Parameters<typeof formatCount>[2]) {
  return formatCount(locale, count, forms).split(" ").slice(1).join(" ");
}

type Overlap = { length: number; label: string };

/** Text a chunk repeats from its neighbour, marked like a highlighter. */
function OverlapMark({ children, label }: { children: string; label: string }) {
  return <mark className="rounded-sm bg-utility-brand-100 text-primary box-decoration-clone" data-overlap title={label}>{children}</mark>;
}

/**
 * Chunk text with Markdown pipe tables rendered as plain-text table cells (never HTML).
 * `leading`/`trailing` mark text shared with the previous/next chunk when it is plain text.
 */
export function ChunkText({ text, leading, trailing }: { text: string; leading?: Overlap | null; trailing?: Overlap | null }) {
  const copy = useCopy();
  const blocks = splitChunkText(text);
  const single = blocks.length === 1 && blocks[0].type === "text" ? blocks[0].text : null;
  if (single !== null && (leading || trailing)) {
    const lead = leading ? text.slice(0, leading.length) : "";
    const trail = trailing ? text.slice(text.length - trailing.length) : "";
    // Only mark what provably sits at the block edges; anything else renders unmarked.
    if ((!lead || single.startsWith(lead)) && (!trail || single.endsWith(trail)) && lead.length + trail.length <= single.length) {
      return (
        <div className="text-sm leading-6 text-secondary" data-testid="chunk-text">
          <p className="whitespace-pre-wrap break-words">
            {lead && leading ? <OverlapMark label={leading.label}>{lead}</OverlapMark> : null}
            {single.slice(lead.length, single.length - trail.length)}
            {trail && trailing ? <OverlapMark label={trailing.label}>{trail}</OverlapMark> : null}
          </p>
        </div>
      );
    }
  }
  return (
    <div className="space-y-4 text-sm leading-6 text-secondary" data-testid="chunk-text">
      {blocks.map((block, index) => block.type === "table" ? (
        // Focusable so a horizontally scrolling table can be scrolled from the keyboard.
        <div aria-label={copy.documents.elementTypes.table} className="max-w-full overflow-x-auto rounded-lg ring-1 ring-secondary" key={index} role="group" tabIndex={0}>
          <table className="min-w-full text-left text-sm leading-5">
            <thead className="bg-secondary">
              <tr>{block.header.map((cell, cellIndex) => <th className="border-b border-secondary px-3 py-2 text-xs font-medium text-tertiary" key={cellIndex} scope="col">{cell}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-secondary">
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => <td className="px-3 py-2 align-top text-secondary" key={cellIndex}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="whitespace-pre-wrap break-words" key={index}>{block.text}</p>)}
    </div>
  );
}

/**
 * Characters at the end of `before` that open `after` (the overlap two neighbouring
 * chunks share). Exact text only, at least a dozen characters, else 0.
 */
function sharedBoundary(before: string, after: string) {
  const MIN = 12;
  const probe = after.slice(0, MIN);
  if (probe.length < MIN) return 0;
  const from = Math.max(0, before.length - Math.min(after.length - 1, 6000));
  for (let index = before.indexOf(probe, from); index >= 0; index = before.indexOf(probe, index + 1)) {
    const tail = before.slice(index);
    if (tail.length < after.length && after.startsWith(tail)) return tail.length;
  }
  return 0;
}

function pageLabel(copy: AppCopy, chunk: ChunkItem) {
  return chunk.pageNumbers.length ? `${copy.units.pageShort} ${chunk.pageNumbers.join(", ")}` : copy.chunking.inspector.noPage;
}

function configuredSize(run: Pick<ChunkRun, "config">) {
  const value = run.config?.chunkSizeTokens;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function ChunkInspector({ run, documentId, parseResult }: { run: ChunkRun; documentId: string | null; parseResult: Parameters<typeof SourceInspector>[0]["parseResult"] }) {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const labels = copy.chunking.inspector;
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(run.chunks[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const selectedChunk = run.chunks.find((chunk) => chunk.id === selectedChunkId) ?? run.chunks[0];
  if (!selectedChunk) return <Panel padding="none"><EmptyState icon="chunk" size="sm" title={labels.empty} /></Panel>;

  const normalizedQuery = query.trim().toLowerCase();
  const visibleChunks = run.chunks.filter((chunk) => !normalizedQuery || `${chunk.ordinal + 1} ${chunk.text} ${chunk.headingPath.join(" ")}`.toLowerCase().includes(normalizedQuery));
  const target = configuredSize(run) ?? Math.max(1, ...run.chunks.map((chunk) => chunk.tokenCount));
  const position = run.chunks.indexOf(selectedChunk);
  const previous = position > 0 ? run.chunks[position - 1] : null;
  const next = position >= 0 ? run.chunks[position + 1] ?? null : null;
  const leadingLength = previous ? sharedBoundary(previous.text, selectedChunk.text) : 0;
  const trailingLength = next ? sharedBoundary(selectedChunk.text, next.text) : 0;
  const leading = previous && leadingLength ? { length: leadingLength, label: interpolate(labels.sharedWith, { n: previous.ordinal + 1 }) } : null;
  const trailing = next && trailingLength ? { length: trailingLength, label: interpolate(labels.sharedWith, { n: next.ordinal + 1 }) } : null;
  const visibleIndex = visibleChunks.findIndex((chunk) => chunk.id === selectedChunk.id);
  const previousVisible = visibleIndex > 0 ? visibleChunks[visibleIndex - 1] : null;
  const nextVisible = visibleIndex >= 0 ? visibleChunks[visibleIndex + 1] ?? null : null;

  /** Selects a chunk and keeps it in view inside the list only (never scrolls the page). */
  function select(chunkId: string, focus = false) {
    setSelectedChunkId(chunkId);
    window.requestAnimationFrame(() => {
      const container = listRef.current;
      const item = Array.from(container?.querySelectorAll<HTMLElement>("[data-chunk-id]") ?? []).find((element) => element.dataset.chunkId === chunkId);
      if (!container || !item) return;
      if (item.offsetTop < container.scrollTop) container.scrollTop = item.offsetTop;
      else if (item.offsetTop + item.offsetHeight > container.scrollTop + container.clientHeight) container.scrollTop = item.offsetTop + item.offsetHeight - container.clientHeight;
      if (focus) item.focus();
    });
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const offset = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!offset || visibleIndex < 0) return;
    const destination = visibleChunks[visibleIndex + offset];
    if (!destination) return;
    event.preventDefault();
    select(destination.id, true);
  }

  return (
    <Panel className="grid overflow-hidden lg:grid-cols-[22rem_minmax(0,1fr)]" data-testid="chunk-inspector" padding="none">
      <aside className="flex min-w-0 flex-col border-b border-secondary lg:border-r lg:border-b-0">
        <div className="border-b border-secondary p-4">
          <p className="flex items-baseline justify-between gap-2 text-sm font-semibold text-primary">
            {labels.list}
            <span className="text-xs font-medium text-quaternary tabular-nums">{normalizedQuery ? `${formatNumber(locale, visibleChunks.length)} / ` : null}{formatNumber(locale, run.chunkCount)}</span>
          </p>
          <Input aria-label={labels.filter} data-testid="chunk-filter" icon="retrieve" onChange={(event) => setQuery(event.target.value)} placeholder={labels.filterPlaceholder} size="sm" value={query} wrapperClassName="mt-3" />
        </div>
        <div className="relative max-h-160 overflow-y-auto overscroll-contain" ref={listRef}>
          {visibleChunks.length ? <ul aria-label={labels.list} className="py-1" onKeyDown={onListKeyDown}>{visibleChunks.map((chunk) => {
            const selected = chunk.id === selectedChunk.id;
            const displayOrdinal = chunk.ordinal + 1;
            const parents = chunk.headingPath.slice(0, -1).join(" › ");
            const fill = Math.min(1, chunk.tokenCount / target);
            return (
              <li key={chunk.id}>
                <button
                  aria-pressed={selected}
                  className="group/chunk relative block w-full px-4 py-2.5 text-left outline-none transition-colors duration-100 hover:bg-primary_hover focus-visible:bg-primary_hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring aria-pressed:bg-active"
                  data-chunk-id={chunk.id}
                  data-testid="chunk-list-item"
                  onClick={() => select(chunk.id)}
                  type="button"
                >
                  {selected ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-fg-brand-primary" /> : null}
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-primary"><span className="mr-2 text-xs text-tertiary tabular-nums">{String(displayOrdinal).padStart(2, "0")}</span>{chunk.headingPath.at(-1) || `${labels.chunk} ${displayOrdinal}`}</span>
                    <span className="shrink-0 text-xs text-tertiary tabular-nums" title={interpolate(labels.tokensOfTarget, { tokens: formatNumber(locale, chunk.tokenCount), size: formatNumber(locale, target) })}>{formatNumber(locale, chunk.tokenCount)}</span>
                  </span>
                  <span className="mt-0.5 block truncate pl-7 text-xs text-tertiary">{[parents, pageLabel(copy, chunk)].filter(Boolean).join(" · ")}</span>
                  {/* Token length against the configured chunk size: how full each chunk is. */}
                  <span aria-hidden="true" className="mt-2 ml-7 block h-1 overflow-hidden rounded-full bg-tertiary">
                    <span className={cn("block h-full rounded-full transition-[width,background-color] duration-300 ease-out motion-reduce:transition-none", selected ? "bg-fg-brand-primary" : "bg-fg-quaternary group-hover/chunk:bg-fg-tertiary")} style={{ width: `${Math.max(2, fill * 100)}%` }} />
                  </span>
                </button>
              </li>
            );
          })}</ul> : <p className="px-4 py-8 text-center text-sm text-tertiary">{labels.noMatches}</p>}
        </div>
      </aside>
      <TransitionPanel as="article" className="min-w-0" data-testid="chunk-inspector-detail" transitionKey={`${run.id}:${selectedChunk.id}`}>
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-secondary px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-md font-semibold text-primary tabular-nums"><span>{labels.chunk} {selectedChunk.ordinal + 1}</span> <span className="font-normal text-quaternary">/ {formatNumber(locale, run.chunkCount)}</span></p>
            {selectedChunk.headingPath.length ? <p className="mt-0.5 text-sm text-tertiary">{selectedChunk.headingPath.join(" › ")}</p> : null}
          </div>
          <div className="flex items-center gap-1">
            <Tooltip title={labels.previous}>
              <Button aria-label={labels.previous} disabled={!previousVisible} iconLeading="chevronUp" onClick={() => previousVisible && select(previousVisible.id)} size="icon-sm" variant="tertiary" />
            </Tooltip>
            <Tooltip title={labels.next}>
              <Button aria-label={labels.next} disabled={!nextVisible} iconLeading="chevronDown" onClick={() => nextVisible && select(nextVisible.id)} size="icon-sm" variant="tertiary" />
            </Tooltip>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-border-secondary" />
            <SourceInspector documentId={documentId} headingPath={selectedChunk.headingPath} pageNumbers={selectedChunk.pageNumbers} parseResult={parseResult} sourceElementIds={selectedChunk.sourceElementIds} triggerLabel={labels.viewSource} />
          </div>
        </header>
        <div className="px-5 py-5 sm:px-6">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-tertiary tabular-nums">
            <span>{formatCount(locale, selectedChunk.tokenCount, copy.units.token)}</span>
            <span aria-hidden="true" className="text-quaternary">·</span>
            <span>{pageLabel(copy, selectedChunk)}</span>
            <span aria-hidden="true" className="text-quaternary">·</span>
            <span>{formatCount(locale, selectedChunk.sourceElementIds.length, copy.units.element)}</span>
          </p>
          {leading || trailing ? (
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-tertiary">
              {[leading && { key: "leading", icon: "chevronUp" as const, label: leading.label }, trailing && { key: "trailing", icon: "chevronDown" as const, label: trailing.label }].filter((item) => Boolean(item)).map((item) => item ? (
                <li className="inline-flex items-center gap-1.5" key={item.key}>
                  <span aria-hidden="true" className="size-3 rounded-sm bg-utility-brand-100" />
                  {item.label}
                  <AppIcon className="size-3.5 text-fg-quaternary" name={item.icon} />
                </li>
              ) : null)}
            </ul>
          ) : null}
          <div className="mt-5 max-w-prose">{selectedChunk.text.trim() ? <ChunkText leading={leading} text={selectedChunk.text} trailing={trailing} /> : <p className="text-sm text-tertiary">—</p>}</div>
          <TechnicalDetails className="mt-6 border-t border-secondary pt-4" data-testid="chunk-technical-details">
            <dl className="grid gap-3 text-xs">
              <div className="min-w-0">
                <dt className="text-quaternary">{labels.sourceElements}</dt>
                <dd className="mt-1 flex min-w-0 flex-wrap gap-1.5">{selectedChunk.sourceElementIds.length
                  ? selectedChunk.sourceElementIds.map((id) => <code className="min-w-0 max-w-full rounded-sm bg-tertiary px-1.5 py-0.5 font-mono text-secondary wrap-anywhere" key={id}>{id}</code>)
                  : <span className="text-tertiary">—</span>}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-quaternary">{labels.chunkId}</dt>
                <dd className="mt-1 font-mono text-secondary wrap-anywhere">{selectedChunk.id}</dd>
              </div>
            </dl>
          </TechnicalDetails>
        </div>
      </TransitionPanel>
    </Panel>
  );
}

/** Three neighbouring chunks drawn to scale, so size and overlap read at a glance while typing. */
function OverlapPreview({ size, overlap }: { size: number; overlap: number }) {
  const copy = useCopy();
  const { preferences } = usePreferences();
  if (!Number.isFinite(size) || !Number.isFinite(overlap) || size <= 0 || overlap < 0 || overlap >= size) return null;
  const stride = size - overlap;
  const total = size + stride * 2;
  const percent = (value: number) => `${(value / total) * 100}%`;
  const rows = ["top-1", "top-6", "top-11"];
  const motion = "transition-[left,width] duration-300 ease-out motion-reduce:transition-none";
  const share = `${(overlap / size) * 100}%`;
  return (
    <figure className="flex flex-col gap-3 border-t border-secondary px-5 py-4 sm:px-6">
      <div aria-hidden="true" className="relative h-15">
        {/* The shared window between two neighbours, drawn across both rows. */}
        {overlap > 0 ? [1, 2].map((index) => (
          <span className={cn("absolute h-9 rounded-md bg-brand-primary ring-1 ring-utility-brand-200 ring-inset", index === 1 ? "top-0" : "top-5", motion)} key={`band-${index}`} style={{ left: percent(index * stride), width: percent(overlap) }} />
        )) : null}
        {rows.map((row, index) => (
          <span className={cn("absolute h-3 overflow-hidden rounded-full bg-quaternary", row, motion)} key={row} style={{ left: percent(index * stride), width: percent(size) }}>
            {overlap > 0 && index > 0 ? <span className={cn("absolute inset-y-0 left-0 bg-fg-brand-secondary", motion)} style={{ width: share }} /> : null}
            {overlap > 0 && index < 2 ? <span className={cn("absolute inset-y-0 right-0 bg-fg-brand-secondary", motion)} style={{ width: share }} /> : null}
          </span>
        ))}
      </div>
      <figcaption className="text-sm text-tertiary tabular-nums">
        {overlap > 0
          ? interpolate(copy.chunking.preview.caption, { overlap: formatNumber(preferences.locale, overlap), size: formatNumber(preferences.locale, size) })
          : copy.chunking.preview.noOverlap}
      </figcaption>
    </figure>
  );
}

function TokenField({ id, label, hint, hintId, error, errorId, value, min, max, unit, onChange }: {
  id: string;
  label: string;
  hint: string;
  hintId: string;
  error?: string | null;
  errorId?: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  const invalid = Boolean(error);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        aria-describedby={invalid ? errorId : hintId}
        aria-invalid={invalid || undefined}
        className="tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        id={id}
        inputMode="numeric"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        trailing={<span className="pointer-events-none pr-1">{unit}</span>}
        type="number"
        value={value}
      />
      {/* The overlap preview below explains both values visually; the hint stays for screen readers. */}
      {invalid ? <HintText id={errorId} invalid role="alert">{error}</HintText> : <span className="sr-only" id={hintId}>{hint}</span>}
    </div>
  );
}

/** One end of the chunks → vectors transformation. */
function LineageNode({ icon, iconColor = "gray", end = false, children, caption }: { icon: SemanticIconName; iconColor?: "gray" | "brand"; end?: boolean; children: ReactNode; caption?: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-4", end && "md:flex-row-reverse md:text-right")}>
      <FeaturedIcon color={iconColor} icon={icon} size="lg" theme="modern" />
      <div className="min-w-0">
        {children}
        {caption ? <div className={cn("mt-1 flex flex-wrap items-center gap-2 text-sm text-tertiary", end && "md:justify-end")}>{caption}</div> : null}
      </div>
    </div>
  );
}

/**
 * The arrow between chunks and vectors: the model above it, the vector size (once known) below it.
 * A light sweeps along it while the model runs.
 */
function TransformConnector({ processing, model, dimensions }: { processing: boolean; model: string | null; dimensions?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2">
      {model ? <span className="max-w-full truncate rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-secondary ring-1 ring-secondary ring-inset" title={model}>{model}</span> : null}
      <span aria-hidden="true" className="hidden w-full items-center md:flex">
        <span className="relative h-0.5 flex-1 overflow-hidden">
          <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-primary" />
          {processing ? <span className="absolute inset-y-0 left-0 w-2/5 animate-progress-indeterminate rounded-full bg-fg-brand-primary motion-reduce:hidden" /> : null}
        </span>
        <AppIcon className={cn("-ml-1 size-4", processing ? "text-fg-brand-primary" : "text-fg-quaternary")} name="chevronRight" />
      </span>
      <AppIcon aria-hidden="true" className={cn("size-5 md:hidden", processing ? "animate-pulse text-fg-brand-primary motion-reduce:animate-none" : "text-fg-quaternary")} name="chevronDown" />
      {dimensions ? <span className="text-xs text-tertiary tabular-nums">{dimensions}</span> : null}
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
  const { activeDocument, activePipeline, capabilities, selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId, selectedParseResult, selectedChunkRun, persistenceStatus, workspaceStatus, chunkStatus, chunkRun, chunkError, embeddingStatus, embeddingRun, embeddingError, runChunking, runEmbedding, resumeEmbeddingTracking } = useDocumentPipeline();
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
  // Its tokens for the quota estimate: exact once the chunk detail is loaded, otherwise the configured
  // chunk size as an upper bound, so the estimate may run long but never short.
  const selectedChunkTokens = selectedChunkRun?.id === selectedChunkRunId && selectedChunkRun.chunks.length > 0
    ? selectedChunkRun.chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0)
    : selectedChunkCount !== null ? selectedChunkCount * initialForm.config.chunkSizeTokens : null;
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
    if (result && !result.reusedArtifact && result.id) {
      toast.success(interpolate(copy.chunking.completedToast, { run: runName(copy, "chunk", result.runNumber) }), {
        description: typeof result.chunkCount === "number" ? formatCount(locale, result.chunkCount, copy.units.chunk) : undefined,
      });
    }
  }
  async function handleEmbedding() {
    const result = await runEmbedding();
    setReuseNotice(result?.reusedArtifact ? "embedding" : null);
    if (result && !result.reusedArtifact && result.id) {
      toast.success(interpolate(copy.embeddings.completedToast, { run: runName(copy, "embedding", result.runNumber) }), {
        description: typeof result.embeddingCount === "number" ? formatCount(locale, result.embeddingCount, copy.units.vector) : undefined,
      });
    }
  }

  if (stage === "embeddings") {
    return (
      <EmbeddingsStage
        canEmbed={canEmbed}
        chunkCount={selectedChunkCount}
        chunkTokens={selectedChunkTokens}
        error={embeddingError}
        inputsPerMinute={capabilities?.limits.embeddingInputsPerMinute ?? null}
        tokensPerMinute={capabilities?.limits.embeddingTokensPerMinute ?? null}
        model={embeddingRun?.model || capabilities?.embeddingModel || null}
        onCreate={() => void handleEmbedding()}
        onResume={() => void resumeEmbeddingTracking()}
        reused={reuseNotice === "embedding"}
        run={embeddingRun}
        selectedEmbeddingRunId={selectedEmbeddingRunId}
        showAction={showAction}
        sourceChunkRuns={activeDocument?.chunkRuns ?? []}
        sourceRunNumber={selectedChunkSummary?.runNumber ?? null}
        status={embeddingStatus}
        upToDate={embeddingUpToDate}
        blocker={!canEmbed && embeddingStatus !== "processing" ? embeddingAvailability : null}
      />
    );
  }

  const labels = copy.chunking;
  const overlapInvalid = overlap >= chunkSize;
  const runDescribedBy = [overlapInvalid ? "chunk-overlap-reason" : null, hasVisibleBlocker(canChunk ? null : chunkAvailability) ? "chunk-disabled-reason" : null, selectedChunkSummary ? "chunk-run-hint" : null].filter(Boolean).join(" ") || undefined;
  const selectedRunName = selectedChunkSummary ? runName(copy, "chunk", selectedChunkSummary.runNumber) : null;
  const processing = chunkStatus === "processing";
  const viewedRunName = chunkRun ? runName(copy, "chunk", chunkRun.runNumber) : null;
  const viewedConfig = chunkRun ? chunkFormConfigFromRun(chunkRun) : null;
  return (
    <div className="mt-8" data-testid="chunking-workspace">
      <Panel data-chunk-config-dirty={chunkFormState.isDirty} data-chunk-up-to-date={chunkFormState.isUpToDate} data-testid="chunking-config-card" padding="none">
        <div className="grid gap-x-10 gap-y-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center gap-1">
              <h2 className="text-sm font-medium text-secondary" id="chunk-strategy-label">{labels.strategy}</h2>
              <InfoTip data-testid="chunk-strategy-help" description={labels.strategyNotes[strategy]} label={labels.strategyHelp} title={labels.strategies[strategy]} />
            </div>
            <SegmentedControl
              aria-labelledby="chunk-strategy-label"
              fullWidth
              onChange={setStrategy}
              options={STRATEGIES.map((option) => ({ value: option, label: labels.strategies[option] }))}
              value={strategy}
            />
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-4" data-testid="chunk-compact-controls">
            <TokenField hint={labels.chunkSizeHint} hintId="chunk-size-hint" id="chunk-size" label={labels.chunkSize} max={4096} min={32} onChange={setChunkSize} unit={unitOf(locale, chunkSize, copy.units.token)} value={chunkSize} />
            <TokenField error={overlapInvalid ? labels.overlapError : null} errorId="chunk-overlap-reason" hint={labels.overlapHint} hintId="chunk-overlap-hint" id="chunk-overlap" label={labels.overlap} max={1024} min={0} onChange={setOverlap} unit={unitOf(locale, overlap, copy.units.token)} value={overlap} />
          </div>
        </div>
        <OverlapPreview overlap={overlap} size={chunkSize} />
        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-secondary px-5 py-3.5 sm:px-6">
          <div className="min-w-0 flex-1 basis-60">
            {hasVisibleBlocker(canChunk ? null : chunkAvailability) ? (
              <StageBlockerRow blocker={chunkAvailability} id="chunk-disabled-reason" kind="chunk" testId="chunk-blocker" />
            ) : selectedRunName && chunkFormState.isDirty ? (
              <p data-state="dirty" data-testid="chunk-config-state"><StatusBadge className="text-sm" status="warning">{interpolate(labels.changedFromRun, { run: selectedRunName })}</StatusBadge></p>
            ) : selectedRunName && chunkFormState.isUpToDate ? (
              <p data-state="current" data-testid="chunk-config-state"><StatusBadge className="text-sm" status="completed">{interpolate(labels.matchesRun, { run: selectedRunName })}</StatusBadge></p>
            ) : null}
            {selectedChunkSummary ? <span className="sr-only" id="chunk-run-hint">{labels.runHint}</span> : null}
          </div>
          {/* Legacy variant names on purpose: `data-variant` carries the emphasis contract. */}
          <Button aria-busy={processing} aria-describedby={runDescribedBy} className="ml-auto" data-testid="chunking-run-action" disabled={!canChunk || overlapInvalid} onClick={() => void handleChunk()} variant={chunkFormState.isUpToDate ? "outline" : "default"}>
            <AppIcon name={processing ? "loading" : "play"} className={processing ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />{processing ? labels.running : labels.run}
          </Button>
        </footer>
      </Panel>
      {chunkError || reuseNotice === "chunk" ? (
        <div className="mt-3 flex flex-col gap-3">
          <ApiErrorNotice error={chunkError} fallback={copy.errors.chunkingFailed} />
          {reuseNotice === "chunk" ? <Notice data-testid="chunk-reuse-notice" icon="refresh">{labels.reuseNotice}</Notice> : null}
        </div>
      ) : null}
      {chunkRun ? (
        <section aria-labelledby="chunk-results-title" className="mt-12" data-testid="chunk-results">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <h2 className="text-lg font-semibold text-primary" id="chunk-results-title">{labels.inspector.title}</h2>
            {viewedRunName ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-tertiary">
                <span>{[interpolate(labels.resultFrom, { run: viewedRunName }), labels.strategies[chunkRun.strategy], viewedConfig ? `${viewedConfig.config.chunkSizeTokens} / ${viewedConfig.config.overlapTokens}` : null].filter(Boolean).join(" · ")}</span>
                {chunkRun.id === selectedChunkRunId ? <Badge color="brand">{copy.runs.inUse}</Badge> : <Badge color="warning">{copy.runs.inspecting}</Badge>}
              </p>
            ) : null}
          </div>
          <MetricGroup className="mt-4" framed>
            <Metric
              label={labels.summary.chunks}
              value={chunkRun.chunkCount}
              visual={tokenCounts.length > 1 ? (
                <SparkBarChart
                  aria-label={interpolate(labels.distribution, { min: formatNumber(locale, minTokens), max: formatNumber(locale, maxTokens) })}
                  categories={["tokens"]}
                  className="hidden h-8 w-20 xl:block"
                  colors={["gray"]}
                  data={tokenCounts.map((tokens, index) => ({ index, tokens }))}
                  index="index"
                />
              ) : undefined}
            />
            <Metric label={labels.summary.average} value={averageTokens} />
            <Metric label={labels.summary.min} value={minTokens} />
            <Metric label={labels.summary.max} value={maxTokens} />
          </MetricGroup>
          <div className="mt-6"><ChunkInspector documentId={activeDocument?.id ?? null} parseResult={chunkParseResult} run={chunkRun} /></div>
        </section>
      ) : null}
    </div>
  );
}

/** Tokens the "title: … | text: …" embedding format adds to every chunk. */
const EMBEDDING_FORMAT_TOKENS = 12;

/**
 * Minutes a run needs at the provider's per-minute embedding quota, whichever limit fills first:
 * inputs (every chunk counts as one) or input tokens. Null when it fits in one window or both
 * limits are unknown.
 */
function embeddingQuotaMinutes(chunkCount: number | null, chunkTokens: number | null, inputsPerMinute: number | null, tokensPerMinute: number | null): number | null {
  if (chunkCount === null) return null;
  const byInputs = inputsPerMinute && inputsPerMinute > 0 ? chunkCount / inputsPerMinute : 0;
  const byTokens = tokensPerMinute && tokensPerMinute > 0 && chunkTokens !== null
    ? (chunkTokens + chunkCount * EMBEDDING_FORMAT_TOKENS) / tokensPerMinute
    : 0;
  const minutes = Math.max(byInputs, byTokens);
  return minutes > 1 ? Math.ceil(minutes) : null;
}

function EmbeddingsStage({ run, status, chunkCount, chunkTokens, inputsPerMinute, tokensPerMinute, sourceRunNumber, sourceChunkRuns, selectedEmbeddingRunId, model, canEmbed, upToDate, blocker, error, reused, showAction, onCreate, onResume }: {
  run: EmbeddingRun | null;
  status: string;
  chunkCount: number | null;
  chunkTokens: number | null;
  inputsPerMinute: number | null;
  tokensPerMinute: number | null;
  sourceRunNumber: number | null | undefined;
  sourceChunkRuns: ReadonlyArray<{ id: string; runNumber?: number | null }>;
  selectedEmbeddingRunId: string | null;
  model: string | null;
  canEmbed: boolean;
  upToDate: boolean;
  blocker: Parameters<typeof StageBlockerRow>[0]["blocker"];
  error: unknown;
  reused: boolean;
  showAction: boolean;
  onCreate: () => void;
  onResume: () => void;
}) {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const labels = copy.embeddings;
  // A paused poll keeps the run "processing" on the server, but nothing is being tracked: no spinner.
  const processing = status === "processing" && !isTrackingPaused(error);
  const quotaMinutes = embeddingQuotaMinutes(chunkCount, chunkTokens, inputsPerMinute, tokensPerMinute);
  const quotaLimits = [
    inputsPerMinute && inputsPerMinute > 0 ? formatCount(locale, inputsPerMinute, copy.units.chunk) : null,
    tokensPerMinute && tokensPerMinute > 0 ? formatCount(locale, tokensPerMinute, copy.units.token) : null,
  ].filter((value): value is string => value !== null);
  const quotaEstimate = quotaMinutes !== null && chunkCount !== null
    ? {
      chunks: formatCount(locale, chunkCount, copy.units.chunk),
      duration: formatCount(locale, quotaMinutes, copy.units.minute),
      limit: formatList(locale, quotaLimits),
    }
    : null;
  const progressLabel = quotaEstimate ? interpolate(labels.progressEstimate, quotaEstimate) : labels.progress;
  // Retrying an exhausted quota fails the same way; its message already says when to come back.
  const canRetry = canEmbed && !processing && apiErrorCode(error) !== "gemini_quota_exhausted";
  const showHint = upToDate && !processing && !hasVisibleBlocker(blocker);
  const describedBy = [hasVisibleBlocker(blocker) ? "embedding-run-disabled-reason" : null, showHint ? "embedding-run-hint" : null].filter(Boolean).join(" ") || undefined;
  const sourceChunkRunId = run?.chunkRunId ?? run?.upstream.chunkRunId ?? null;
  const sourceChunkRun = sourceChunkRunId ? sourceChunkRuns.find((item) => item.id === sourceChunkRunId) : undefined;
  const duration = run?.timing.durationMs != null ? formatMs(locale, run.timing.durationMs) : null;

  return (
    <div className="mt-8 flex flex-col gap-3" data-testid="embeddings-workspace">
      <Panel data-testid="embedding-action-card" padding="none">
        <div className="grid items-center gap-5 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(8rem,16rem)_minmax(0,1fr)] md:gap-8" data-testid="embedding-lineage">
          <LineageNode caption={sourceRunNumber !== null && sourceRunNumber !== undefined ? interpolate(copy.chunking.resultFrom, { run: runName(copy, "chunk", sourceRunNumber) }) : null} icon="chunk">
            <p className="flex min-w-0 items-baseline gap-1.5 text-display-xs font-semibold text-primary tabular-nums" data-testid="embedding-primary-result">
              {chunkCount === null
                ? <><span className="text-quaternary">—</span> <span className="text-md font-medium text-tertiary">{copy.units.chunk.other}</span></>
                : <><TransitionNumber>{formatNumber(locale, chunkCount)}</TransitionNumber> <span className="text-md font-medium text-tertiary">{unitOf(locale, chunkCount, copy.units.chunk)}</span></>}
            </p>
          </LineageNode>
          <TransformConnector dimensions={run?.dimensions != null ? formatCount(locale, run.dimensions, copy.units.dimension) : null} model={model} processing={processing} />
          <LineageNode
            caption={run ? (
              <>
                <span className="tabular-nums">{[runName(copy, "embedding", run.runNumber), duration].filter(Boolean).join(" · ")}</span>
                {run.id === selectedEmbeddingRunId ? <Badge color="brand">{copy.runs.inUse}</Badge> : <Badge color="warning">{copy.runs.inspecting}</Badge>}
              </>
            ) : null}
            end
            icon="embed"
            iconColor={processing ? "brand" : "gray"}
          >
            <p className={cn("flex min-w-0 items-baseline gap-1.5 tabular-nums md:justify-end", run ? "text-display-xs font-semibold text-primary" : "text-md font-medium text-tertiary")} data-testid="embedding-output-result">
              {run ? <><TransitionNumber>{formatNumber(locale, run.embeddingCount)}</TransitionNumber> <span className="text-md font-medium text-tertiary">{unitOf(locale, run.embeddingCount, copy.units.vector)}</span></> : labels.pending}
            </p>
          </LineageNode>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-secondary px-5 py-3.5 sm:px-6">
          <div className="min-w-0 flex-1 basis-60">
            {processing ? (
              // The button and the connector already show the work; the sentence is for screen readers.
              <div className="max-w-xl" role="status">
                <ProgressBar label={progressLabel} />
                <span className="sr-only">{progressLabel}</span>
              </div>
            ) : (
              <StageBlockerRow blocker={blocker} id="embedding-run-disabled-reason" kind="embedding" testId="embedding-blocker" />
            )}
            {/* Same contract as Parse and Chunking: the re-run cost is the action's description, not a visible line. */}
            {showHint ? <span className="sr-only" id="embedding-run-hint">{labels.createHint}</span> : null}
          </div>
          {showAction ? (
            // Legacy variant names on purpose: `data-variant` carries the emphasis contract.
            <Button aria-busy={processing} aria-describedby={describedBy} className="ml-auto" data-testid="embedding-run-action" disabled={!canEmbed} onClick={onCreate} variant={upToDate ? "outline" : "default"}>
              <AppIcon name={processing ? "loading" : "play"} className={processing ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
              <TransitionText>{processing ? labels.creating : labels.create}</TransitionText>
            </Button>
          ) : null}
        </footer>
      </Panel>
      {quotaEstimate && canEmbed && !upToDate && !processing && !error ? (
        <Notice data-testid="embedding-quota-notice" icon="clock" title={interpolate(labels.largeDocumentTitle, quotaEstimate)} tone="info">
          {interpolate(labels.largeDocumentBody, quotaEstimate)}
        </Notice>
      ) : null}
      <ApiErrorNotice data-testid="embedding-error" error={error} fallback={copy.errors.embeddingFailed} onResume={onResume} onRetry={canRetry ? onCreate : undefined} />
      {reused ? <Notice data-testid="embedding-reuse-notice" icon="refresh">{labels.reuseNotice}</Notice> : null}
      {run ? (
        // Model, vector count, dimensions and duration are on the lineage card above; only storage details remain.
        <section className="mt-1" data-testid="embedding-result-details">
          <TechnicalDetails data-testid="embedding-details">
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-quaternary">{labels.storage}</dt><dd className="mt-1 font-medium text-secondary">{labels.stored}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-quaternary">{labels.sourceChunks}</dt><dd className="mt-1 font-medium text-secondary">{sourceChunkRun ? runName(copy, "chunk", sourceChunkRun.runNumber) : <span className="font-mono wrap-anywhere">{sourceChunkRunId ?? "—"}</span>}</dd></div>
              <div className="min-w-0"><dt className="text-xs text-quaternary">{labels.format}</dt><dd className="mt-1 font-mono text-xs text-secondary wrap-anywhere">{run.embeddingFormatVersion}</dd></div>
            </dl>
          </TechnicalDetails>
        </section>
      ) : null}
    </div>
  );
}
