"use client";

import { useEffect, useRef, useState } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { OcrSourceDetails } from "@/components/ocr-source-details";
import { hasVisibleBlocker, InspectionBand, PipelineErrorMessage, RunHistory, StageBlockerRow, StageNextAction } from "@/components/pipeline-learning-ui";
import { StageContext, StagePage } from "@/components/pipeline-stage-screens";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { AppIcon } from "@/components/ui/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, ModalBody, ModalFooter } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { ProgressBar } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { ThinkingText, TransitionNumber, TransitionPanel, TransitionText } from "@/components/ui/transitions";
import { getPipelineAvailability } from "@/lib/blockers";
import { type AppCopy, interpolate, runName, useCopy } from "@/lib/copy";
import type { DocumentParseResponse, ParsedElement } from "@/lib/document-parse-types";
import { formatCount, formatNumber } from "@/lib/format";
import { completedCompatibleRun, type ReparseImpact } from "@/lib/pipeline-lineage";
import { cn } from "@/lib/utils";

const PHASE_ORDER = ["queued", "worker_started", "source_loaded", "docling_starting", "docling_ready", "docling_converted", "content_normalized", "completed"] as const;
type ParsePhase = (typeof PHASE_ORDER)[number];

function isParsePhase(value: string | null | undefined): value is ParsePhase {
  return PHASE_ORDER.includes(value as ParsePhase);
}

function formatElapsed(startedAt: string | null | undefined, now: number, durationMs?: number | null) {
  if (durationMs !== null && durationMs !== undefined) {
    const seconds = Math.max(0, Math.floor(durationMs / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  if (!startedAt) return "—";
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

type OutlineEntry = {
  id: string;
  label: string;
  pageNumber: number | null;
  level: number | null;
  kind: "heading" | "page";
};

function parsedElements(result: DocumentParseResponse) {
  return result.structured.elements.length > 0
    ? result.structured.elements
    : result.structured.pages.flatMap((page) => page.elements);
}

function buildOutline(result: DocumentParseResponse, pageLabel: string): OutlineEntry[] {
  const headings = parsedElements(result).filter((element) => element.type === "heading" && element.text.trim());
  if (headings.length > 0) {
    return headings.map((element) => ({
      id: element.id,
      label: element.text,
      pageNumber: element.pageNumbers[0] ?? null,
      level: Math.max(1, element.level ?? 1),
      kind: "heading" as const,
    }));
  }
  return result.structured.pages.map((page) => ({
    id: `page-${page.pageNumber}`,
    label: `${pageLabel} ${page.pageNumber}`,
    pageNumber: page.pageNumber,
    level: null,
    kind: "page" as const,
  }));
}

function outlineSection(result: DocumentParseResponse, entry: OutlineEntry | undefined) {
  if (!entry) return [];
  if (entry.kind === "page") return result.structured.pages.find((page) => page.pageNumber === entry.pageNumber)?.elements ?? [];
  const elements = parsedElements(result);
  const start = elements.findIndex((element) => element.id === entry.id);
  if (start < 0) return [];
  const level = Math.max(1, entry.level ?? 1);
  const end = elements.findIndex((element, index) => index > start && element.type === "heading" && Math.max(1, element.level ?? 1) <= level);
  return elements.slice(start, end < 0 ? elements.length : end);
}

function TableElement({ element }: { element: ParsedElement }) {
  const copy = useCopy();
  const rows = element.table?.rows ?? [];
  if (rows.length === 0) return <p className="max-w-prose whitespace-pre-wrap text-sm leading-7 text-secondary">{element.text}</p>;
  const [header, ...body] = rows;
  return (
    // Focusable so a horizontally scrolling table can be scrolled from the keyboard.
    <div aria-label={copy.documents.elementTypes.table} className="max-w-full overflow-x-auto rounded-lg ring-1 ring-secondary" role="group" tabIndex={0}>
      <table className="min-w-full text-left text-sm leading-5 tabular-nums">
        <thead className="bg-secondary">
          <tr>{header.map((cell, index) => <th className="border-b border-secondary px-3 py-2 text-xs font-medium text-tertiary" key={`${cell}-${index}`} scope="col">{cell}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-secondary">
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td className="px-3 py-2 align-top text-secondary" key={`${cell}-${cellIndex}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const headingSizes: Record<number, string> = { 1: "text-lg", 2: "text-md" };

/** One parsed element: its type in a quiet gutter, its text in reading typography. */
function StructuredElement({ element }: { element: ParsedElement }) {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const pages = element.pageNumbers.length ? ` · ${copy.units.pageShort} ${element.pageNumbers.join(", ")}` : "";
  return (
    <TransitionPanel as="article" className="grid gap-x-6 gap-y-1.5 px-5 py-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:px-6" data-element-type={element.type} transitionKey={element.id}>
      <p className="text-xs text-quaternary tabular-nums sm:pt-1">{copy.documents.elementTypes[element.type]}{pages}</p>
      <div className="min-w-0">
        {element.type === "table" ? <TableElement element={element} /> : element.type === "list" ? (
          <ul className="max-w-prose list-disc pl-5 text-sm leading-7 text-secondary marker:text-fg-quaternary"><li>{element.text}</li></ul>
        ) : element.type === "heading" ? (
          <h3 className={cn("max-w-prose font-semibold text-primary", headingSizes[Math.max(1, element.level ?? 1)] ?? "text-sm")}>{element.text}</h3>
        ) : (
          <p className="max-w-prose whitespace-pre-wrap text-sm leading-7 text-secondary">{element.text}</p>
        )}
        <OcrSourceDetails element={element} locale={preferences.locale} />
      </div>
    </TransitionPanel>
  );
}

function OutlineList({ entries, selectedId, onSelect, label }: { entries: OutlineEntry[]; selectedId: string | null; onSelect: (id: string) => void; label: string }) {
  const copy = useCopy();
  return (
    <ul aria-label={label} className="flex flex-col gap-px">
      {entries.map((entry) => {
        const selected = entry.id === selectedId;
        return (
          <li key={entry.id}>
            <button
              aria-current={selected ? "true" : undefined}
              className={cn(
                "relative flex w-full items-baseline gap-2 rounded-md py-1.5 pr-2 text-left text-sm text-tertiary transition-colors duration-100 hover:bg-primary_hover hover:text-secondary",
                selected && "bg-active font-medium text-primary hover:bg-active hover:text-primary",
              )}
              onClick={() => onSelect(entry.id)}
              style={{ paddingLeft: entry.level ? `${(Math.min(entry.level, 4) - 1) * 0.75 + 0.75}rem` : "0.75rem" }}
              title={entry.label}
              type="button"
            >
              {selected ? <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-fg-brand-primary" /> : null}
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {entry.kind === "heading" && entry.pageNumber !== null ? <span className="shrink-0 text-xs font-normal text-quaternary tabular-nums">{copy.units.pageShort} {entry.pageNumber}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Outline + one reading panel; the outline is sticky beside the content instead of a nested scroll box. */
function ParsedContent({ result }: { result: DocumentParseResponse }) {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const labels = copy.parse.content;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const outline = buildOutline(result, labels.page);
  const hasHeadings = outline.some((entry) => entry.kind === "heading");
  const effectiveSelectedId = selectedId && outline.some((entry) => entry.id === selectedId) ? selectedId : outline[0]?.id ?? null;
  const selectedIndex = outline.findIndex((entry) => entry.id === effectiveSelectedId);
  const selectedEntry = outline[selectedIndex];
  const previousEntry = selectedIndex > 0 ? outline[selectedIndex - 1] : null;
  const nextEntry = selectedIndex >= 0 ? outline[selectedIndex + 1] ?? null : null;
  const elements = outlineSection(result, selectedEntry);
  const list = outline.length
    ? <OutlineList entries={outline} label={labels.outline} onSelect={setSelectedId} selectedId={effectiveSelectedId} />
    : <p className="px-3 py-2 text-sm text-tertiary">{labels.noPages}</p>;
  // The page already shows in the outline and on every element, so the meta line stays position + size.
  const sectionMeta = [
    selectedIndex >= 0 ? interpolate(labels.section, { current: formatNumber(preferences.locale, selectedIndex + 1), total: formatNumber(preferences.locale, outline.length) }) : null,
    formatCount(preferences.locale, elements.length, copy.units.element),
  ].filter(Boolean).join(" · ");

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8" data-testid="parsed-content">
      <Disclosure className="lg:hidden" contentClassName="max-h-96 overflow-y-auto px-2 py-2" meta={formatNumber(preferences.locale, outline.length)} title={labels.outline}>
        {!hasHeadings ? <p className="px-3 pb-2 text-sm text-tertiary">{labels.noOutline}</p> : null}
        {list}
      </Disclosure>
      <nav aria-label={labels.outline} className="hidden min-w-0 lg:sticky lg:top-6 lg:block lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:overscroll-contain" data-testid="parsed-content-outline">
        <p className="px-3 pb-2 text-xs font-medium text-quaternary">{labels.outline}</p>
        {!hasHeadings ? <p className="px-3 pb-2 text-sm text-tertiary">{labels.noOutline}</p> : null}
        {list}
      </nav>
      <Panel aria-label={selectedEntry?.label ?? labels.outline} as="section" data-testid="parsed-section-inspector" padding="none">
        <header className="flex items-center justify-between gap-3 border-b border-secondary py-2 pr-2 pl-5 sm:pl-6">
          <p className="min-w-0 truncate text-xs text-tertiary tabular-nums">{sectionMeta}</p>
          {outline.length > 1 ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <Tooltip title={labels.previousSection}>
                <Button aria-label={labels.previousSection} disabled={!previousEntry} iconLeading="chevronLeft" onClick={() => previousEntry && setSelectedId(previousEntry.id)} size="icon-sm" variant="tertiary" />
              </Tooltip>
              <Tooltip title={labels.nextSection}>
                <Button aria-label={labels.nextSection} disabled={!nextEntry} iconLeading="chevronRight" onClick={() => nextEntry && setSelectedId(nextEntry.id)} size="icon-sm" variant="tertiary" />
              </Tooltip>
            </div>
          ) : null}
        </header>
        {elements.length ? (
          <div className="divide-y divide-secondary">{elements.map((element) => <StructuredElement element={element} key={element.id} />)}</div>
        ) : <p className="px-6 py-10 text-center text-sm text-tertiary">{labels.noElements}</p>}
      </Panel>
    </div>
  );
}

function RawOutput({ result }: { result: DocumentParseResponse }) {
  const copy = useCopy();
  const labels = copy.parse.content;
  const [view, setView] = useState<"markdown" | "json">("markdown");
  const content = view === "markdown" ? result.markdown : JSON.stringify(result.structured, null, 2);
  const codeSurface = "max-h-[min(70vh,48rem)] overflow-auto rounded-lg bg-secondary p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-secondary";

  async function copyContent() {
    try {
      await navigator.clipboard.writeText(content);
      toast.success(labels.copied);
    } catch {
      toast.error(labels.copyFailed);
    }
  }

  return (
    <Disclosure className="mt-10" contentClassName="flex flex-col gap-3 px-4 pt-3 pb-4" data-testid="parse-raw-output" title={labels.rawOutput}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl aria-label={labels.viewMode} onChange={setView} options={[{ value: "markdown", label: labels.markdown }, { value: "json", label: labels.json }]} size="sm" value={view} />
        <Button iconLeading="copy" onClick={() => void copyContent()} size="sm" variant="secondary">{labels.copy}</Button>
      </div>
      {view === "markdown"
        ? <pre aria-label={labels.markdown} className={codeSurface} data-testid="parsed-markdown" role="region" tabIndex={0}>{result.markdown}</pre>
        : <pre aria-label={labels.json} className={codeSurface} data-testid="parsed-json" role="region" tabIndex={0}>{JSON.stringify(result.structured, null, 2)}</pre>}
    </Disclosure>
  );
}

function reparseImpactLine(copy: AppCopy, impact: ReparseImpact) {
  const dialog = copy.parse.reparseDialog;
  if (impact.target === "scratch") return dialog.scratchClears;
  const template = impact.clearsChunk && impact.clearsEmbedding ? dialog.clearsBoth : impact.clearsChunk ? dialog.clearsChunk : dialog.clearsEmbedding;
  return interpolate(template, { pipeline: impact.pipelineName ?? "" });
}

/** Reparse removes downstream results from the working lineage, so it is confirmed first (I-5). */
function ReparseDialog({ open, impact, onOpenChange, onConfirm }: { open: boolean; impact: ReparseImpact; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const copy = useCopy();
  const dialog = copy.parse.reparseDialog;
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent data-testid="reparse-dialog" description={reparseImpactLine(copy, impact)} icon="refresh" iconColor="warning" title={dialog.title}>
        <ModalBody className="pt-4">
          <ul className="flex flex-col gap-2.5 text-sm text-tertiary">
            <li className="flex gap-2.5"><AppIcon className="mt-0.5 size-4 shrink-0 text-fg-quaternary" name="history" />{dialog.history}</li>
            <li className="flex gap-2.5"><AppIcon className="mt-0.5 size-4 shrink-0 text-fg-quaternary" name="timer" />{dialog.cost}</li>
          </ul>
        </ModalBody>
        <ModalFooter>
          <AlertDialogCancel asChild><Button size="lg" variant="secondary">{copy.common.cancel}</Button></AlertDialogCancel>
          <AlertDialogAction asChild><Button data-testid="reparse-confirm" onClick={onConfirm} size="lg" variant="primary">{dialog.confirm}</Button></AlertDialogAction>
        </ModalFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type PhaseState = "complete" | "current" | "upcoming" | "error";

const phaseMarker: Record<PhaseState, string> = {
  complete: "bg-tertiary text-fg-secondary",
  current: "bg-brand-solid text-white ring-4 ring-utility-brand-100",
  upcoming: "bg-primary ring-1 ring-primary ring-inset",
  error: "bg-error-solid text-white ring-4 ring-utility-error-100",
};

const phaseLabel: Record<PhaseState, string> = {
  complete: "text-secondary",
  current: "font-semibold text-brand-secondary",
  upcoming: "text-quaternary",
  error: "font-semibold text-error-primary",
};

/** The eight backend phases as a compact rail; completed phases stay neutral, the current one is brand. */
function PhaseRail({ phaseIndex, running, failed }: { phaseIndex: number; running: boolean; failed: boolean }) {
  const labels = useCopy().parse;
  const lastIndex = PHASE_ORDER.length - 1;
  return (
    // On phones the rail is dots only: eight truncated labels are noise, and the panel title names the current phase.
    <ol aria-label={labels.progress.label} className="grid grid-cols-8">
      {PHASE_ORDER.map((item, index) => {
        const done = index < phaseIndex || (!running && !failed && phaseIndex === lastIndex);
        const state: PhaseState = done ? "complete" : index === phaseIndex ? (failed ? "error" : "current") : "upcoming";
        return (
          <li aria-current={state === "current" ? "step" : undefined} className="flex min-w-0 flex-col gap-2" data-state={state} key={item}>
            <span aria-hidden="true" className="flex items-center">
              <span className={cn("grid size-5 shrink-0 place-items-center rounded-full transition-[background-color,box-shadow] duration-300 ease-out", phaseMarker[state])}>
                {state === "complete" ? <AppIcon className="size-3" name="check" strokeWidth={2.5} />
                  : state === "error" ? <AppIcon className="size-3" name="close" strokeWidth={2.5} />
                    : state === "current" ? <span className="size-1.5 animate-pulse rounded-full bg-white motion-reduce:animate-none" /> : null}
              </span>
              {index < lastIndex ? <span className={cn("mx-1.5 h-px flex-1 transition-colors duration-300", done ? "bg-fg-quaternary" : "bg-border-secondary")} /> : null}
            </span>
            <span className={cn("truncate pr-2 text-xs max-sm:sr-only", phaseLabel[state])} title={labels.phases[item]}>{labels.phases[item]}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function ParseScreen() {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const labels = copy.parse;
  const {
    activeDocument, activePipeline, parseResult, parseStatus, parseProgress, parseProgressEstimated, parsePhase, parseError,
    persistenceStatus, workspaceStatus, selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId, inspectedParseRunId, reparseImpact,
    selectParseRun, inspectParseRun, setPipelineParseRun, reparseActiveDocument, resumeParseTracking,
  } = useDocumentPipeline();
  const [now, setNow] = useState(() => Date.now());
  const [showLifecycle, setShowLifecycle] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isProcessing = parseStatus === "queued" || parseStatus === "running";
  useEffect(() => {
    if (!isProcessing) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isProcessing]);

  const parseRuns = activeDocument?.parseRuns ?? [];
  const selectedRun = parseRuns.find((run) => run.id === selectedParseRunId) ?? null;
  const currentRun = parseRuns.find((run) => run.status === "queued" || run.status === "running") ?? selectedRun;
  const resultRun = parseResult?.parseRunId ? parseRuns.find((run) => run.id === parseResult.parseRunId) ?? null : null;
  const resultRunName = resultRun ? runName(copy, "parse", resultRun.runNumber) : null;
  const selection = { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId };
  const availability = getPipelineAvailability(locale, "parse", { document: activeDocument, pipeline: activePipeline, selection, processing: isProcessing, persistenceStatus, workspaceStatus });
  const nextAvailability = getPipelineAvailability(locale, "chunk", { document: activeDocument, pipeline: activePipeline, selection, parseRun: selectedRun, persistenceStatus, workspaceStatus });
  const canParse = availability.allowed;
  const hasParsed = Boolean(activeDocument?.activeParseRunId || selectedParseRunId);
  const phase = parsePhase ?? currentRun?.phase ?? (parseStatus === "completed" ? "completed" : parseStatus === "queued" ? "queued" : null);
  const phaseIndex = isParsePhase(phase) ? PHASE_ORDER.indexOf(phase) : -1;
  const running = isProcessing || currentRun?.status === "queued" || currentRun?.status === "running";
  const failed = !running && (currentRun?.status === "failed" || parseStatus === "failed");
  const parsed = !running && !failed && (currentRun?.status === "completed" || Boolean(parseResult));
  const status: Status = running ? "processing" : failed ? "error" : parsed ? "completed" : "idle";
  const statusLabel = running
    ? (isParsePhase(phase) ? labels.phases[phase] : labels.actions.running)
    : failed ? labels.status.failed : parsed ? labels.status.parsed : labels.status.notParsed;
  const lifecycleVisible = showLifecycle || isProcessing;
  // Said once: the lifecycle panel names the state while it is open, and the empty state says "not parsed".
  const showStatusBadge = !lifecycleVisible && status !== "idle";
  const pollTimedOut = parseError?.code === "parse_poll_timeout";
  const canContinue = Boolean(selectedRun && completedCompatibleRun(selectedRun) && !isProcessing);
  const summaryFields = parseResult ? [
    [labels.summary.pages, parseResult.summary.pageCount],
    [labels.summary.headings, parseResult.summary.headingCount],
    [labels.summary.paragraphs, parseResult.summary.paragraphCount],
    [labels.summary.lists, parseResult.summary.listCount],
    [labels.summary.tables, parseResult.summary.tableCount],
    [labels.summary.elements, parseResult.structured.elements.length],
  ] as const : [];
  const describedBy = [hasVisibleBlocker(canParse ? null : availability) ? "parse-action-disabled-reason" : null, hasParsed ? "parse-run-hint" : null].filter(Boolean).join(" ") || undefined;
  const resultDuration = resultRun?.timing.durationMs != null ? formatElapsed(null, now, resultRun.timing.durationMs) : null;

  // A parse that finishes while the page is open earns a small confirmation, named after
  // the run that actually finished (never the previous result that stays on screen meanwhile).
  const trackedRunId = useRef<string | null>(null);
  const runningRunId = currentRun && (currentRun.status === "queued" || currentRun.status === "running") ? currentRun.id : null;
  const finishedRunId = !running && parseResult?.parseRunId ? parseResult.parseRunId : null;
  const toastTitle = resultRunName ? interpolate(labels.completedToast, { run: resultRunName }) : null;
  const toastDescription = parseResult ? formatCount(locale, parseResult.structured.elements.length, copy.units.element) : undefined;
  useEffect(() => {
    if (runningRunId) trackedRunId.current = runningRunId;
    else if (failed) trackedRunId.current = null;
  }, [runningRunId, failed]);
  useEffect(() => {
    if (!finishedRunId || !toastTitle || finishedRunId !== trackedRunId.current) return;
    trackedRunId.current = null;
    toast.success(toastTitle, { description: toastDescription });
  }, [finishedRunId, toastTitle, toastDescription]);

  function startParse() {
    setConfirmOpen(false);
    setShowLifecycle(true);
    void reparseActiveDocument();
  }

  return (
    <StagePage testId="parse-screen">
      <PageHeader
        actions={(
          <div className="flex flex-wrap items-center gap-3" data-testid="parse-workspace-controls">
            <div className="flex flex-wrap items-center gap-3" data-testid="parse-document-status">
              {showStatusBadge ? <StatusBadge className="text-sm" status={status}>{statusLabel}</StatusBadge> : null}
              {/* Legacy variant names on purpose: `data-variant` carries the emphasis contract. */}
              <Button aria-busy={isProcessing} aria-describedby={describedBy} data-testid="parse-run-action" disabled={!canParse} onClick={() => (reparseImpact.requiresConfirmation ? setConfirmOpen(true) : startParse())} variant={hasParsed ? "outline" : "default"}>
                {isProcessing ? <AppIcon name="loading" className="size-4 animate-spin motion-reduce:animate-none" /> : <AppIcon name="refresh" className="size-4" />}
                {isProcessing ? labels.actions.running : hasParsed ? labels.actions.reparse : labels.actions.parse}
              </Button>
              {hasParsed ? <span className="sr-only" id="parse-run-hint">{labels.actions.reparseHint}</span> : null}
              {/* The only live region here: phase/state text. Timer, percentage and button label stay silent (A2). */}
              <p className="sr-only" data-testid="parse-status-announcement" role="status">{statusLabel}</p>
            </div>
          </div>
        )}
        context={<StageContext />}
        data-testid="parse-page-header"
        description={labels.description}
        title={copy.nav.parse}
      />
      <StageBlockerRow blocker={canParse ? null : availability} className="mt-6" id="parse-action-disabled-reason" kind="parse" testId="parse-blocker" />
      <InspectionBand canUse={Boolean(activePipeline)} inspectedId={inspectedParseRunId} kind="parse" onBack={inspectParseRun} onUse={setPipelineParseRun} runs={parseRuns} selectedId={selectedParseRunId} />

      {lifecycleVisible ? (
        <Panel className="mt-8" data-testid="parse-lifecycle">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-md font-semibold text-primary">
                {running ? <Spinner size="sm" /> : failed ? <AppIcon className="size-4 text-fg-error-primary" name="warning" /> : <AppIcon className="size-4 text-fg-tertiary" name="check" strokeWidth={2} />}
                {running ? <ThinkingText>{statusLabel}</ThinkingText> : <TransitionText>{statusLabel}</TransitionText>}
              </p>
              <p className="mt-1 text-sm text-tertiary tabular-nums">
                {currentRun?.runNumber != null ? <>{runName(copy, "parse", currentRun.runNumber)} · </> : null}
                <TransitionNumber>{parseProgress}</TransitionNumber>%{parseProgressEstimated ? <> · {labels.progress.estimated}</> : null}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-tertiary">{labels.progress.elapsed}</p>
              <p className="mt-0.5 text-display-xs font-semibold text-primary tabular-nums">{formatElapsed(currentRun?.timing.startedAt, now, currentRun?.status === "completed" ? currentRun.timing.durationMs : null)}</p>
            </div>
          </div>
          <ProgressBar className="mt-4" label={`${labels.progress.label} ${parseProgress}%`} size="md" tone={failed ? "error" : running ? "brand" : "gray"} value={Math.min(100, Math.max(0, parseProgress))} />
          <div className="mt-5"><PhaseRail failed={failed} phaseIndex={phaseIndex} running={running} /></div>
        </Panel>
      ) : null}
      {pollTimedOut ? (
        <Notice action={<Button onClick={() => void resumeParseTracking()} size="sm" variant="secondary">{labels.actions.resumeTracking}</Button>} className="mt-4 items-center" data-testid="parse-poll-timeout" icon="clock" tone="warning">
          <span className="text-secondary">{labels.pollTimeout}</span>
        </Notice>
      ) : parseError ? <div className="mt-4"><PipelineErrorMessage message={parseError.message} /></div> : null}

      {parseResult ? (
        <div className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-primary" id="parsed-content-title">{labels.content.title}</h2>
              {resultRunName ? (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-tertiary tabular-nums">
                  <span>{[interpolate(labels.resultFrom, { run: resultRunName }), resultDuration].filter(Boolean).join(" · ")}</span>
                  {resultRun?.id === selectedParseRunId ? <Badge color="brand">{copy.runs.inUse}</Badge> : <Badge color="warning">{copy.runs.inspecting}</Badge>}
                </p>
              ) : null}
            </div>
            <SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} />
          </div>
          <section aria-label={labels.content.title} className="mt-5" data-testid="parse-result-summary" id="parse-result-summary">
            <MetricGroup className="sm:grid-flow-row sm:grid-cols-3 xl:grid-flow-col xl:grid-cols-none" framed>
              {summaryFields.map(([label, value]) => <Metric key={label} label={label} value={value} />)}
            </MetricGroup>
          </section>
          <section aria-labelledby="parsed-content-title" className="mt-6">
            <ParsedContent result={parseResult} />
          </section>
          <RawOutput result={parseResult} />
        </div>
      ) : workspaceStatus === "loading" ? (
        <Skeleton className="mt-10" label={copy.overview.workspace.loading} rows={4} />
      ) : (
        <Panel className="mt-10 overflow-hidden" padding="none">
          <EmptyState description={labels.noOutputDescription} icon="parse" title={labels.noOutput} titleAs="p" />
        </Panel>
      )}

      <RunHistory defaultId={activeDocument?.activeParseRunId} hasPipeline={Boolean(activePipeline)} inspectedId={inspectedParseRunId} kind="parse" onInspect={selectParseRun} onUse={setPipelineParseRun} runs={parseRuns} selectedId={selectedParseRunId} />
      <StageNextAction blocker={nextAvailability.allowed ? null : nextAvailability} disabled={!canContinue} href="/chunking" label={labels.next} reason={labels.nextReason} stageBlocker={canParse ? null : availability} testId="parse-next-action" />
      <ReparseDialog impact={reparseImpact} onConfirm={startParse} onOpenChange={setConfirmOpen} open={confirmOpen} />
    </StagePage>
  );
}
