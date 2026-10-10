"use client";

import { SlidingTabs, ThinkingText, TransitionNumber, TransitionPanel, TransitionText } from "@/components/ui/transitions";
import { TransitionDialogContent } from "@/components/ui/transition-surface";

import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { OcrSourceDetails } from "@/components/ocr-source-details";
import { hasVisibleBlocker, InspectionBand, PipelineErrorMessage, RunHistory, StageBlockerRow, StageNextAction } from "@/components/pipeline-learning-ui";
import { StageContextCard } from "@/components/pipeline-stage-screens";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { getPipelineAvailability } from "@/lib/blockers";
import { type AppCopy, interpolate, useCopy } from "@/lib/copy";
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
  if (rows.length === 0) return <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{element.text}</p>;
  const [header, ...body] = rows;
  return (
    // Focusable so a horizontally scrolling table can be scrolled from the keyboard.
    <div aria-label={copy.documents.elementTypes.table} className="max-w-full overflow-x-auto rounded-md border border-border" role="group" tabIndex={0}>
      <table className="min-w-full text-left text-sm">
        <thead className="bg-technical">
          <tr>{header.map((cell, index) => <th className="border-b border-border px-3 py-2 font-medium" key={`${cell}-${index}`} scope="col">{cell}</th>)}</tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr className="border-b border-border last:border-b-0" key={rowIndex}>
              {row.map((cell, cellIndex) => <td className="px-3 py-2 align-top" key={`${cell}-${cellIndex}`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StructuredElement({ element }: { element: ParsedElement }) {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const pages = element.pageNumbers.length ? ` · ${copy.units.pageShort} ${element.pageNumbers.join(", ")}` : "";
  return (
    <TransitionPanel as="article" className="border-b border-border px-5 py-4 last:border-b-0" data-element-type={element.type} transitionKey={element.id}>
      <p className="mb-2 text-xs text-subtle-foreground tabular-nums">{copy.documents.elementTypes[element.type]}{pages}</p>
      {element.type === "table" ? <TableElement element={element} /> : element.type === "list" ? (
        <ul className="list-disc pl-5 text-sm leading-6 text-foreground"><li>{element.text}</li></ul>
      ) : element.type === "heading" ? (
        <h3 className="text-base font-semibold leading-6 text-foreground">{element.text}</h3>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{element.text}</p>
      )}
      <OcrSourceDetails element={element} locale={preferences.locale} />
    </TransitionPanel>
  );
}

function OutlineList({ entries, selectedId, onSelect, label }: { entries: OutlineEntry[]; selectedId: string | null; onSelect: (id: string) => void; label: string }) {
  const copy = useCopy();
  return (
    <ul aria-label={label} className="space-y-0.5">
      {entries.map((entry) => {
        const selected = entry.id === selectedId;
        return (
          <li key={entry.id}>
            <button
              aria-current={selected ? "true" : undefined}
              className={cn("relative block w-full rounded-md py-1.5 pr-2 text-left text-sm text-muted-foreground transition-colors hover:bg-surface-subtle hover:text-foreground", selected && "bg-secondary font-medium text-foreground hover:bg-secondary")}
              onClick={() => onSelect(entry.id)}
              style={{ paddingLeft: entry.level ? `${(Math.min(entry.level, 4) - 1) * 0.75 + 0.75}rem` : "0.75rem" }}
              title={entry.label}
              type="button"
            >
              {selected ? <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand" /> : null}
              <span className="block truncate">{entry.label}</span>
              {entry.kind === "heading" && entry.pageNumber !== null ? <span className="block text-xs text-subtle-foreground tabular-nums">{copy.units.pageShort} {entry.pageNumber}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Outline + one content panel; the outline is sticky beside the content instead of a nested scroll box. */
function ParsedContent({ result }: { result: DocumentParseResponse }) {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const labels = copy.parse.content;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const outline = buildOutline(result, labels.page);
  const hasHeadings = outline.some((entry) => entry.kind === "heading");
  const effectiveSelectedId = selectedId && outline.some((entry) => entry.id === selectedId) ? selectedId : outline[0]?.id ?? null;
  const selectedEntry = outline.find((entry) => entry.id === effectiveSelectedId);
  const elements = outlineSection(result, selectedEntry);
  const list = outline.length
    ? <OutlineList entries={outline} label={labels.outline} onSelect={setSelectedId} selectedId={effectiveSelectedId} />
    : <p className="px-3 py-2 text-xs text-muted-foreground">{labels.noPages}</p>;
  const sectionMeta = [
    formatCount(preferences.locale, elements.length, copy.units.element),
    selectedEntry?.pageNumber != null ? `${copy.units.pageShort} ${selectedEntry.pageNumber}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start lg:gap-6" data-testid="parsed-content">
      <Disclosure className="lg:hidden" contentClassName="max-h-none px-2 py-2" meta={formatNumber(preferences.locale, outline.length)} title={labels.outline}>
        {!hasHeadings ? <p className="px-3 pb-2 text-xs text-subtle-foreground">{labels.noOutline}</p> : null}
        {list}
      </Disclosure>
      <nav aria-label={labels.outline} className="hidden min-w-0 lg:sticky lg:top-6 lg:block lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto" data-testid="parsed-content-outline">
        <p className="px-3 pb-2 text-xs font-medium text-muted-foreground">{labels.outline}</p>
        {!hasHeadings ? <p className="px-3 pb-2 text-xs text-subtle-foreground">{labels.noOutline}</p> : null}
        {list}
      </nav>
      <section aria-label={selectedEntry?.label ?? labels.outline} className="min-w-0 rounded-lg border border-border bg-card" data-testid="parsed-section-inspector">
        {elements.length ? (
          <>
            <p className="border-b border-border px-5 py-2.5 text-xs text-muted-foreground tabular-nums">{sectionMeta}</p>
            {elements.map((element) => <StructuredElement element={element} key={element.id} />)}
          </>
        ) : <p className="px-5 py-8 text-center text-sm text-muted-foreground">{labels.noElements}</p>}
      </section>
    </div>
  );
}

function RawOutput({ result }: { result: DocumentParseResponse }) {
  const copy = useCopy();
  const labels = copy.parse.content;
  const [view, setView] = useState<"markdown" | "json">("markdown");
  return (
    <Disclosure contentClassName="p-0" data-testid="parse-raw-output" title={labels.rawOutput}>
      <SlidingTabs value={view} aria-label={labels.viewMode} className="flex gap-1 border-b border-border bg-technical px-4 py-2" role="group">
        {(["markdown", "json"] as const).map((option) => <Button aria-pressed={view === option} key={option} onClick={() => setView(option)} size="sm" variant={view === option ? "secondary" : "ghost"}>{labels[option]}</Button>)}
      </SlidingTabs>
      {view === "markdown"
        ? <pre aria-label={labels.markdown} className="max-h-[min(70vh,800px)] overflow-auto whitespace-pre-wrap px-4 py-5 font-mono text-xs leading-6 text-muted-foreground" data-testid="parsed-markdown" role="region" tabIndex={0}>{result.markdown}</pre>
        : <pre aria-label={labels.json} className="max-h-[min(70vh,800px)] overflow-auto whitespace-pre-wrap px-4 py-5 font-mono text-xs leading-6 text-muted-foreground" data-testid="parsed-json" role="region" tabIndex={0}>{JSON.stringify(result.structured, null, 2)}</pre>}
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
    <DialogPrimitive.Root onOpenChange={onOpenChange} open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="steplab-overlay fixed inset-0 z-50 bg-overlay/35 dark:bg-overlay/65" />
        <TransitionDialogContent className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl focus:outline-none sm:p-6" data-testid="reparse-dialog">
          <DialogPrimitive.Title className="text-base font-semibold text-foreground">{dialog.title}</DialogPrimitive.Title>
          <DialogPrimitive.Description asChild>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
              <li className="text-foreground">{reparseImpactLine(copy, impact)}</li>
              <li>{dialog.history}</li>
              <li>{dialog.cost}</li>
            </ul>
          </DialogPrimitive.Description>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <DialogPrimitive.Close asChild><Button size="sm" variant="outline">{copy.common.cancel}</Button></DialogPrimitive.Close>
            <Button data-testid="reparse-confirm" onClick={onConfirm} size="sm">{dialog.confirm}</Button>
          </div>
        </TransitionDialogContent>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
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
  const selection = { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId };
  const availability = getPipelineAvailability(locale, "parse", { document: activeDocument, pipeline: activePipeline, selection, processing: isProcessing, persistenceStatus, workspaceStatus });
  const nextAvailability = getPipelineAvailability(locale, "chunk", { document: activeDocument, pipeline: activePipeline, selection, parseRun: selectedRun, persistenceStatus, workspaceStatus });
  const canParse = availability.allowed;
  const hasParsed = Boolean(activeDocument?.activeParseRunId || selectedParseRunId);
  const phase = parsePhase ?? currentRun?.phase ?? (parseStatus === "completed" ? "completed" : parseStatus === "queued" ? "queued" : null);
  const phaseIndex = isParsePhase(phase) ? PHASE_ORDER.indexOf(phase) : -1;
  const running = isProcessing || currentRun?.status === "queued" || currentRun?.status === "running";
  const failed = !running && (currentRun?.status === "failed" || parseStatus === "failed");
  const statusTone: StatusTone = running ? "running" : failed ? "error" : currentRun?.status === "completed" || parseResult ? "neutral" : "idle";
  const statusLabel = running
    ? (isParsePhase(phase) ? labels.phases[phase] : labels.actions.running)
    : failed ? labels.status.failed : statusTone === "neutral" ? labels.status.parsed : labels.status.notParsed;
  const lifecycleVisible = showLifecycle || isProcessing;
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

  function startParse() {
    setConfirmOpen(false);
    setShowLifecycle(true);
    void reparseActiveDocument();
  }

  return (
    <div className="min-w-0 overflow-x-clip bg-background" data-testid="parse-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <PageHeader data-testid="parse-page-header" description={labels.description} title={copy.nav.parse} />

        <div className="mt-6 grid min-w-0 gap-3 lg:grid-cols-[max-content_minmax(0,1fr)]" data-testid="parse-workspace-controls">
          <StageContextCard className="min-w-0" />
          <section className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2.5" data-testid="parse-document-status">
            <StatusPill tone={statusTone}>{statusLabel}</StatusPill>
            <Button aria-busy={isProcessing} aria-describedby={describedBy} data-testid="parse-run-action" disabled={!canParse} onClick={() => (reparseImpact.requiresConfirmation ? setConfirmOpen(true) : startParse())} size="sm" title={hasParsed ? labels.actions.reparseHint : undefined} variant={hasParsed ? "outline" : "default"}>
              {isProcessing ? <AppIcon name="loading" className="size-3.5 animate-spin motion-reduce:animate-none" /> : <AppIcon name="refresh" className="size-3.5" />}
              {isProcessing ? labels.actions.running : hasParsed ? labels.actions.reparse : labels.actions.parse}
            </Button>
            {hasParsed ? <span className="sr-only" id="parse-run-hint">{labels.actions.reparseHint}</span> : null}
            {/* The only live region here: phase/state text. Timer, percentage and button label stay silent (A2). */}
            <p className="sr-only" data-testid="parse-status-announcement" role="status">{statusLabel}</p>
          </section>
        </div>
        <StageBlockerRow blocker={canParse ? null : availability} className="mt-3" id="parse-action-disabled-reason" kind="parse" testId="parse-blocker" />
        <InspectionBand canUse={Boolean(activePipeline)} inspectedId={inspectedParseRunId} kind="parse" onBack={inspectParseRun} onUse={setPipelineParseRun} runs={parseRuns} selectedId={selectedParseRunId} />

        {lifecycleVisible ? (
          <section className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_120px]" data-testid="parse-lifecycle">
            <div>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-foreground">{isProcessing ? <ThinkingText>{statusLabel}</ThinkingText> : <TransitionText>{statusLabel}</TransitionText>}</span>
                <span className="text-muted-foreground tabular-nums"><TransitionNumber>{parseProgress}</TransitionNumber>% · {parseProgressEstimated ? labels.progress.estimated : labels.progress.confirmed}</span>
              </div>
              <div aria-label={`${labels.progress.label} ${parseProgress}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={parseProgress} className="mt-3 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar"><div className="h-full origin-left bg-foreground transition-transform duration-300 motion-reduce:transition-none" style={{ transform: `scaleX(${Math.min(100, Math.max(0, parseProgress)) / 100})` }} /></div>
              <ol className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8">{PHASE_ORDER.map((item, index) => <li className={index <= phaseIndex ? "text-xs text-foreground" : "text-xs text-subtle-foreground"} key={item}><span aria-hidden="true" className={index <= phaseIndex ? "mb-1 block h-1 rounded-full bg-muted-foreground" : "mb-1 block h-1 rounded-full bg-border"} />{labels.phases[item]}</li>)}</ol>
            </div>
            <div className="border-border md:border-l md:pl-4">
              <p className="text-xs text-muted-foreground">{labels.progress.elapsed}</p>
              <p className="mt-1 text-lg font-semibold text-foreground tabular-nums">{formatElapsed(currentRun?.timing.startedAt, now, currentRun?.status === "completed" ? currentRun.timing.durationMs : null)}</p>
            </div>
          </section>
        ) : null}
        {pollTimedOut ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning-border bg-warning-subtle px-3 py-2" data-testid="parse-poll-timeout" role="status">
            <p className="min-w-0 text-sm text-foreground">{labels.pollTimeout}</p>
            <Button onClick={() => void resumeParseTracking()} size="sm" variant="outline">{labels.actions.resumeTracking}</Button>
          </div>
        ) : parseError ? <div className="mt-4"><PipelineErrorMessage message={parseError.message} /></div> : null}

        {parseResult ? (
          <>
            <section className="mt-6" data-testid="parse-result-summary" id="parse-result-summary">
              <dl className="grid grid-cols-2 gap-4 border-y border-border py-3 sm:grid-cols-3 lg:grid-cols-6">{summaryFields.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold text-foreground tabular-nums">{formatNumber(locale, value)}</dd></div>)}</dl>
            </section>
            <section aria-labelledby="parsed-content-title" className="mt-8">
              <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold text-foreground" id="parsed-content-title">{labels.content.title}</h2><SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} /></div>
              <div className="mt-4"><ParsedContent result={parseResult} /></div>
            </section>
            <div className="mt-6"><RawOutput result={parseResult} /></div>
          </>
        ) : workspaceStatus === "loading" ? (
          <Skeleton className="mt-6" label={copy.overview.workspace.loading} rows={3} />
        ) : (
          <EmptyState className="mt-6 rounded-lg border border-dashed border-border" icon="parse" title={labels.noOutput} titleAs="p" />
        )}

        <RunHistory defaultId={activeDocument?.activeParseRunId} hasPipeline={Boolean(activePipeline)} inspectedId={inspectedParseRunId} kind="parse" onInspect={selectParseRun} onUse={setPipelineParseRun} runs={parseRuns} selectedId={selectedParseRunId} />
        <StageNextAction blocker={nextAvailability.allowed ? null : nextAvailability} disabled={!canContinue} href="/chunking" label={labels.next} reason={labels.nextReason} testId="parse-next-action" />
        <ReparseDialog impact={reparseImpact} onConfirm={startParse} onOpenChange={setConfirmOpen} open={confirmOpen} />
      </div>
    </div>
  );
}
