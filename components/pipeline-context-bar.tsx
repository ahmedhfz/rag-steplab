"use client";

import Link from "next/link";

import { useDocumentPipeline, type PipelineOperationStatus } from "@/components/document-pipeline-provider";
import { AppIcon } from "@/components/ui/app-icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isExceptionTone, PIPELINE_STEP_STATUS, StatusIcon, StatusPill } from "@/components/ui/status-pill";
import { type AppCopy, useCopy } from "@/lib/copy";
import { operationToStepState } from "@/lib/overview-view-model";
import type { RunSummary } from "@/lib/rag-api-types";

function runToOperationStatus(run: RunSummary | undefined, fallback: PipelineOperationStatus): PipelineOperationStatus {
  if (!run) return fallback;
  if (run.status === "queued" || run.status === "running") return "processing";
  if (run.status === "failed") return "error";
  if (run.status === "completed" && run.isCompatible) return "completed";
  return "stale";
}

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
  const presentation = state ? PIPELINE_STEP_STATUS[state] : null;
  const statusLabel = state ? copy.status[state] : null;
  // The arrow belongs to the following stage so a wrapped line never ends on an arrow.
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {withArrow ? <AppIcon aria-hidden="true" name="arrowRight" className="size-3.5 shrink-0 text-input" /> : null}
      <Link className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-secondary" data-status={status} href={href}>
        <span className="whitespace-nowrap text-xs font-medium text-foreground">{label}</span>
        {presentation && statusLabel ? isExceptionTone(presentation.tone)
          ? <StatusPill className="whitespace-nowrap" tone={presentation.tone}>{statusLabel}</StatusPill>
          : <StatusIcon icon={presentation.icon} label={statusLabel} tone={presentation.tone} /> : null}
      </Link>
    </span>
  );
}

const triggerValueClass = "[&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:whitespace-nowrap";

export function PipelineContextBar({ showLineage = true }: { showLineage?: boolean } = {}) {
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

  return (
    <section className="border-b border-border bg-card px-4 py-2.5 sm:px-8" data-testid="pipeline-context-bar">
      <div className="grid min-w-0 gap-1 sm:flex sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1.5 min-[1360px]:flex-nowrap">
        <div className="flex min-w-0 items-center gap-1.5 sm:w-[14rem] sm:max-w-[14rem] sm:shrink-0">
          <AppIcon name="document" className="size-4 shrink-0 text-subtle-foreground" />
          <Select disabled={persistenceStatus !== "available" || documents.length === 0} onValueChange={(value) => void selectPersistedDocument(value)} value={activeDocumentId ?? ""}>
            <SelectTrigger aria-label={labels.document} className={`h-8 w-full min-w-0 overflow-hidden border-0 px-1 text-xs font-medium text-foreground shadow-none ring-0 sm:text-xs sm:w-[12rem] sm:max-w-[12rem] ${triggerValueClass}`} data-testid="pipeline-context-document-selector" title={documentName ?? documentPlaceholder}>
              <SelectValue placeholder={documentPlaceholder} />
            </SelectTrigger>
            <SelectContent>{documents.map((document) => <SelectItem className="h-auto min-h-8 whitespace-normal [overflow-wrap:anywhere]" key={document.id} value={document.id}>{document.fileName}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {showLineage ? <span aria-hidden="true" className="hidden text-input sm:inline">/</span> : null}
        <div className="flex min-w-0 items-center gap-1.5 sm:contents">
          <AppIcon name="embed" className="size-4 shrink-0 text-subtle-foreground sm:hidden" />
          <Select disabled={!activeDocumentId || pipelines.length === 0} onValueChange={(value) => void selectPipeline(value)} value={activePipelineId ?? ""}>
            <SelectTrigger aria-label={labels.pipeline} className={`h-8 w-full min-w-0 overflow-hidden border-0 px-1 text-xs font-medium text-foreground shadow-none ring-0 sm:text-xs sm:w-[16rem] sm:max-w-[16rem] sm:shrink-0 ${triggerValueClass}`} data-testid="pipeline-context-pipeline-selector" title={activePipeline?.name ?? labels.choosePipeline}>
              {/* The trigger shows only the name; the "default" marker lives in the list. */}
              <SelectValue placeholder={labels.choosePipeline}>{activePipeline ? activePipeline.name : undefined}</SelectValue>
            </SelectTrigger>
            <SelectContent>{pipelines.map((pipeline) => (
              <SelectItem className="h-auto min-h-8 whitespace-normal [overflow-wrap:anywhere]" key={pipeline.id} value={pipeline.id}>
                {pipeline.name}{pipeline.isDefault ? <span className="ml-1.5 text-xs font-normal text-subtle-foreground">{copy.common.defaultPipeline}</span> : null}
              </SelectItem>
            ))}</SelectContent>
          </Select>
        </div>

        {showLineage ? (
          <nav aria-label={copy.common.indexingLineage} className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 min-[1360px]:ml-auto min-[1360px]:shrink-0 min-[1360px]:flex-nowrap">
            <LineageLink copy={copy} href="/parse" label={copy.nav.parse} status={lineageLoading ? undefined : parseStageStatus} />
            <LineageLink copy={copy} href="/chunking" label={copy.nav.chunking} status={lineageLoading ? undefined : chunkStageStatus} withArrow />
            <LineageLink copy={copy} href="/embeddings" label={copy.nav.embeddings} status={lineageLoading ? undefined : embeddingStageStatus} withArrow />
            {isHistorical ? <StatusPill className="ml-1 whitespace-nowrap" tone="warning">{copy.runs.historical}</StatusPill> : null}
          </nav>
        ) : null}
      </div>
    </section>
  );
}
