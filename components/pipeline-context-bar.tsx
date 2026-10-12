"use client";

import Link from "next/link";
import { Fragment } from "react";

import { useDocumentPipeline, type PipelineOperationStatus } from "@/components/document-pipeline-provider";
import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { type AppCopy, useCopy } from "@/lib/copy";
import { operationToStepState } from "@/lib/overview-view-model";
import type { RunSummary } from "@/lib/rag-api-types";
import type { PipelineStepState } from "@/lib/rag-ui-types";
import { cn } from "@/lib/utils";

function runToOperationStatus(run: RunSummary | undefined, fallback: PipelineOperationStatus): PipelineOperationStatus {
  if (!run) return fallback;
  if (run.status === "queued" || run.status === "running") return "processing";
  if (run.status === "failed") return "error";
  if (run.status === "completed" && run.isCompatible) return "completed";
  return "stale";
}

/** Step states in the shared status language. Only exceptions earn visible words; the rest are icons. */
const STEP_STATUS: Record<PipelineStepState, { status: Status; icon?: SemanticIconName; label: boolean }> = {
  Completed: { status: "completed", label: false },
  Ready: { status: "ready", label: false },
  Processing: { status: "processing", label: true },
  Error: { status: "error", label: true },
  Stale: { status: "stale", label: true },
  Skipped: { status: "idle", icon: "minus", label: false },
  Locked: { status: "idle", icon: "lock", label: false },
  "Not started": { status: "idle", icon: "circle", label: false },
};

function LineageLink({
  copy,
  href,
  label,
  status,
  withArrow,
}: {
  copy: AppCopy;
  href: string;
  label: string;
  /** Omitted while the workspace is loading, so no stage shows a false "Locked". */
  status?: PipelineOperationStatus;
  withArrow?: boolean;
}) {
  const state = status ? operationToStepState(status) : null;
  const presentation = state ? STEP_STATUS[state] : null;
  const statusLabel = state ? copy.status[state] : null;
  // The arrow belongs to the following stage so a wrapped line never ends on an arrow.
  return (
    <span className="inline-flex min-w-0 items-center gap-0.5">
      {withArrow ? <AppIcon aria-hidden="true" name="chevronRight" className="size-3.5 shrink-0 text-fg-quaternary" /> : null}
      <Link className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-secondary transition-colors hover:bg-primary_hover hover:text-primary" data-status={status} href={href}>
        <span className="whitespace-nowrap">{label}</span>
        {presentation && statusLabel ? (
          <StatusBadge appearance={presentation.label ? "inline" : "icon"} icon={presentation.icon} status={presentation.status}>{statusLabel}</StatusBadge>
        ) : null}
      </Link>
    </span>
  );
}

const triggerValueClass = "[&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:whitespace-nowrap";
// A quiet, borderless switcher (breadcrumb style): the field ring only appears for keyboard focus.
const ghostTrigger = cn(
  "h-8 w-auto min-w-0 gap-1.5 rounded-md bg-transparent px-2 text-sm font-medium text-primary shadow-none ring-0",
  "hover:bg-primary_hover hover:ring-0 focus:ring-0 focus-visible:ring-2 focus-visible:ring-brand data-[state=open]:bg-primary_hover data-[state=open]:ring-0",
  "disabled:bg-transparent disabled:text-tertiary",
  triggerValueClass,
);

export type PipelineContextBarLayout = "bar" | "inline";

/**
 * The active document and pipeline, switchable in place.
 * - `bar` (default): the full-width strip on top of Playground and Evaluation, with the indexing lineage.
 * - `inline`: a breadcrumb-style switcher for the Parsing, Chunking and Embeddings page headers.
 */
export function PipelineContextBar({ showLineage = true, layout = "bar" }: { showLineage?: boolean; layout?: PipelineContextBarLayout } = {}) {
  const copy = useCopy();
  const {
    documents,
    activeDocumentId,
    activeDocumentMetadata,
    activeDocument,
    activePipeline,
    selectedParseRunId,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    activePipelineId,
    pipelines,
    persistenceStatus,
    workspaceStatus,
    chunkStatus,
    embeddingStatus,
    selectPersistedDocument,
    selectPipeline,
  } = useDocumentPipeline();
  const labels = copy.overview.workspace;
  const documentName = activeDocument?.fileName ?? activeDocumentMetadata?.fileName;
  // Only the selected lineage counts: no fallback to the document's latest run (B-9).
  const selectedParse = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId);
  const selectedChunk = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId);
  const selectedEmbedding = activeDocument?.embeddingRuns.find((run) => run.id === selectedEmbeddingRunId);
  const hasDocument = Boolean(activeDocumentId || documentName);
  const parseInFlight = Boolean(activeDocument?.parseRuns.some((run) => run.status === "queued" || run.status === "running"));
  const parseFallback: PipelineOperationStatus = !hasDocument ? "locked" : parseInFlight ? "processing" : "ready";
  const parseStageStatus = runToOperationStatus(selectedParse, parseFallback);
  const chunkStageStatus = runToOperationStatus(selectedChunk, selectedParseRunId ? chunkStatus : "locked");
  const embeddingStageStatus = runToOperationStatus(selectedEmbedding, selectedChunkRunId ? embeddingStatus : "locked");
  const lineageLoading = workspaceStatus === "loading";
  const isHistorical = Boolean(selectedParse?.historicalLineage || selectedChunk?.historicalLineage || selectedEmbedding?.historicalLineage);
  const documentPlaceholder = documentName ?? (documents.length ? labels.chooseDocument : copy.common.noActiveDocument);
  const inline = layout === "inline";

  const switchers = (
    <>
      <Select disabled={persistenceStatus !== "available" || documents.length === 0} onValueChange={(value) => void selectPersistedDocument(value)} value={activeDocumentId ?? ""}>
        <SelectTrigger aria-label={labels.document} className={cn(ghostTrigger, "max-w-full sm:max-w-72")} data-testid="pipeline-context-document-selector" title={documentName ?? documentPlaceholder}>
          <AppIcon name="document" className="size-4 shrink-0 text-fg-quaternary" />
          <SelectValue placeholder={documentPlaceholder} />
        </SelectTrigger>
        <SelectContent>{documents.map((document) => <SelectItem className="h-auto min-h-8 whitespace-normal wrap-anywhere" key={document.id} value={document.id}>{document.fileName}</SelectItem>)}</SelectContent>
      </Select>
      <span className="flex min-w-0 max-w-full items-center gap-1">
        <span aria-hidden="true" className="hidden text-sm text-quaternary sm:inline">/</span>
        <Select disabled={!activeDocumentId || pipelines.length === 0} onValueChange={(value) => void selectPipeline(value)} value={activePipelineId ?? ""}>
          <SelectTrigger aria-label={labels.pipeline} className={cn(ghostTrigger, "max-w-full sm:max-w-64")} data-testid="pipeline-context-pipeline-selector" title={activePipeline?.name ?? labels.choosePipeline}>
            <AppIcon name="link" className="size-4 shrink-0 text-fg-quaternary" />
            {/* The trigger shows only the name; the "default" marker lives in the list. */}
            <SelectValue placeholder={labels.choosePipeline}>{activePipeline ? activePipeline.name : undefined}</SelectValue>
          </SelectTrigger>
          <SelectContent>{pipelines.map((pipeline) => (
            <SelectItem className="h-auto min-h-8 whitespace-normal wrap-anywhere" key={pipeline.id} value={pipeline.id}>
              {pipeline.name}{pipeline.isDefault ? <span className="ml-1.5 text-xs font-normal text-quaternary">{copy.common.defaultPipeline}</span> : null}
            </SelectItem>
          ))}</SelectContent>
        </Select>
      </span>
    </>
  );

  const lineage = showLineage ? (
    <nav aria-label={copy.common.indexingLineage} className="flex min-w-0 flex-wrap items-center gap-x-0.5 gap-y-0.5 min-[1360px]:ml-auto min-[1360px]:shrink-0 min-[1360px]:flex-nowrap">
      {[
        { href: "/parse", label: copy.nav.parse, status: parseStageStatus },
        { href: "/chunking", label: copy.nav.chunking, status: chunkStageStatus },
        { href: "/embeddings", label: copy.nav.embeddings, status: embeddingStageStatus },
      ].map((stage, index) => (
        <Fragment key={stage.href}>
          <LineageLink copy={copy} href={stage.href} label={stage.label} status={lineageLoading ? undefined : stage.status} withArrow={index > 0} />
        </Fragment>
      ))}
      {isHistorical ? <StatusBadge className="ml-2" status="stale">{copy.runs.historical}</StatusBadge> : null}
    </nav>
  ) : null;

  return (
    <section
      className={cn(inline ? "-ml-2 min-w-0" : "border-b border-secondary bg-primary px-4 py-2 sm:px-8")}
      data-layout={layout}
      data-testid="pipeline-context-bar"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 min-[1360px]:flex-nowrap">
        {switchers}
        {lineage}
      </div>
    </section>
  );
}
