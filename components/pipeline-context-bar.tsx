"use client";

import Link from "next/link";
import { FileText } from "lucide-react";

import { useDocumentPipeline, type PipelineOperationStatus } from "@/components/document-pipeline-provider";
import { OperationStatusBadge } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RunSummary } from "@/lib/rag-api-types";
import type { AppLocale } from "@/lib/copy";

function runToOperationStatus(run: RunSummary | undefined, fallback: PipelineOperationStatus): PipelineOperationStatus {
  if (!run) return fallback;
  if (run.status === "queued" || run.status === "running") return "processing";
  if (run.status === "failed") return "error";
  if (run.status === "completed" && run.isCompatible) return "completed";
  return "stale";
}

function LineageLink({
  href,
  label,
  locale,
  status,
}: {
  href: string;
  label: string;
  locale: AppLocale;
  status: PipelineOperationStatus;
}) {
  return (
    <Link className="flex min-w-0 items-center gap-1.5 rounded-[8px] px-1.5 py-1 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/25" href={href}>
      <span className="text-xs font-medium text-foreground">{label}</span>
      <OperationStatusBadge locale={locale} status={status} />
    </Link>
  );
}

export function PipelineContextBar({ showLineage = true }: { showLineage?: boolean } = {}) {
  const { preferences } = usePreferences();
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
    chunkStatus,
    embeddingStatus,
    selectPersistedDocument,
    selectPipeline,
  } = useDocumentPipeline();
  const locale = preferences.locale;
  const documentName = activeDocument?.fileName ?? activeDocumentMetadata?.fileName;
  const selectedParse = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId) ?? activeDocument?.parseRuns[0];
  const selectedChunk = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId);
  const selectedEmbedding = activeDocument?.embeddingRuns.find((run) => run.id === selectedEmbeddingRunId);
  const hasDocument = Boolean(activeDocumentId || documentName);
  const hasParse = Boolean(selectedParseRunId || selectedParse);
  const hasChunk = Boolean(selectedChunkRunId || selectedChunk);
  const parseStageStatus = runToOperationStatus(selectedParse, hasDocument ? "ready" : "locked");
  const chunkStageStatus = runToOperationStatus(selectedChunk, hasParse ? chunkStatus : "locked");
  const embeddingStageStatus = runToOperationStatus(selectedEmbedding, hasChunk ? embeddingStatus : "locked");
  const isHistorical = Boolean(selectedParse?.historicalLineage || selectedChunk?.historicalLineage || selectedEmbedding?.historicalLineage);
  const labels = locale === "tr"
    ? { document: "Doküman bağlamı", pipeline: "Indexing pipeline", placeholder: "Doküman seçin", noDocument: "Aktif doküman yok", noPipeline: "Pipeline seçin", lineage: "Indexing lineage", historical: "geçmiş lineage", parse: "Parse", chunk: "Chunk", embedding: "Embedding" }
    : { document: "Document context", pipeline: "Indexing pipeline", placeholder: "Select a document", noDocument: "No active document", noPipeline: "Select a pipeline", lineage: "Indexing lineage", historical: "historical lineage", parse: "Parse", chunk: "Chunk", embedding: "Embedding" };

  return (
    <section className="border-b border-border bg-card px-4 py-2.5 sm:px-8" data-testid="pipeline-context-bar">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 min-[1360px]:flex-nowrap">
        <div className="flex min-w-0 max-w-full items-center gap-1.5 sm:w-[14rem] sm:max-w-[14rem] sm:shrink-0">
          <FileText aria-hidden="true" className="size-4 shrink-0 text-subtle-foreground" />
          <span className="sr-only">{labels.document}</span>
          <Select disabled={persistenceStatus !== "available" || documents.length === 0} onValueChange={(value) => void selectPersistedDocument(value)} value={activeDocumentId ?? ""}>
            <SelectTrigger aria-label={labels.document} className="h-8 min-w-0 max-w-[min(22rem,55vw)] overflow-hidden border-0 px-1 text-xs font-medium text-foreground shadow-none sm:w-[12rem] sm:max-w-[12rem] [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:whitespace-nowrap" data-testid="pipeline-context-document-selector" title={documentName ?? (documents.length ? labels.placeholder : labels.noDocument)}>
              <SelectValue placeholder={documentName ?? (documents.length ? labels.placeholder : labels.noDocument)} />
            </SelectTrigger>
            <SelectContent>{documents.map((document) => <SelectItem className="h-auto min-h-8 whitespace-normal break-words" key={document.id} value={document.id}>{document.fileName}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {showLineage ? <span aria-hidden="true" className="text-input">/</span> : null}
        <Select disabled={!activeDocumentId || pipelines.length === 0} onValueChange={(value) => void selectPipeline(value)} value={activePipelineId ?? ""}>
          <SelectTrigger aria-label={labels.pipeline} className="h-8 min-w-0 max-w-[min(18rem,55vw)] overflow-hidden border-0 px-1 text-xs font-semibold text-accent-foreground shadow-none sm:w-[16rem] sm:max-w-[16rem] sm:shrink-0 [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:whitespace-nowrap" data-testid="pipeline-context-pipeline-selector" title={activePipeline?.name ?? labels.noPipeline}>
            <SelectValue placeholder={labels.noPipeline} />
          </SelectTrigger>
          <SelectContent>{pipelines.map((pipeline) => <SelectItem className="h-auto min-h-8 whitespace-normal break-words" key={pipeline.id} value={pipeline.id}>{pipeline.name}{pipeline.isDefault ? " · default" : ""}</SelectItem>)}</SelectContent>
        </Select>

        {showLineage ? <nav aria-label={labels.lineage} className="flex min-w-0 flex-wrap items-center gap-1 min-[1360px]:ml-auto min-[1360px]:shrink-0 min-[1360px]:flex-nowrap">
            <span className="sr-only">{labels.lineage}</span>
            <LineageLink href="/parse" label={labels.parse} locale={locale} status={parseStageStatus} />
            <span aria-hidden="true" className="text-input">→</span>
            <LineageLink href="/chunking" label={labels.chunk} locale={locale} status={chunkStageStatus} />
            <span aria-hidden="true" className="text-input">→</span>
            <LineageLink href="/embeddings" label={labels.embedding} locale={locale} status={embeddingStageStatus} />
            {isHistorical ? <span className="truncate text-[10px] text-warning">({labels.historical})</span> : null}
          </nav> : null}
      </div>
    </section>
  );
}

/** Other surfaces keep their existing compact empty-state behavior; build pages render PipelineContextBar directly. */
export function ConditionalPipelineContextBar() {
  const { activeDocumentId } = useDocumentPipeline();
  return <div className={activeDocumentId ? "sr-only" : undefined}><PipelineContextBar /></div>;
}
