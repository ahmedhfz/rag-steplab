"use client";

import Link from "next/link";
import { FileText } from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function runNumber(runs: Array<{ id: string; runNumber?: number | null; createdAt?: string | null }>, id: string | null) {
  const persisted = id ? runs.find((run) => run.id === id)?.runNumber : null;
  if (persisted) return persisted;
  const ordered = [...runs].sort((left, right) => {
    const byDate = String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? ""));
    return byDate || left.id.localeCompare(right.id);
  });
  const index = id ? ordered.findIndex((run) => run.id === id) : -1;
  return index >= 0 ? index + 1 : null;
}

export function PipelineContextBar() {
  const { preferences } = usePreferences();
  const { documents, activeDocumentId, activeDocumentMetadata, activeDocument, selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId, activePipelineId, pipelines, persistenceStatus, selectPersistedDocument, selectPipeline } = useDocumentPipeline();
  const documentName = activeDocument?.fileName ?? activeDocumentMetadata?.fileName;
  const parseNumber = runNumber(activeDocument?.parseRuns ?? [], selectedParseRunId);
  const chunkNumber = runNumber(activeDocument?.chunkRuns ?? [], selectedChunkRunId);
  const embeddingNumber = runNumber(activeDocument?.embeddingRuns ?? [], selectedEmbeddingRunId);
  const labels = preferences.locale === "tr"
    ? { document: "Doküman bağlamı", placeholder: "Doküman seçin", noDocument: "Aktif doküman yok", noPipeline: "Pipeline seçin", historical: "geçmiş lineage", pipeline: "Indexing pipeline", parse: "Ayrıştırma", chunk: "Parçalama", embedding: "Embedding" }
    : { document: "Document context", placeholder: "Select a document", noDocument: "No active document", noPipeline: "Select a pipeline", historical: "historical lineage", pipeline: "Indexing pipeline", parse: "Parsing", chunk: "Chunking", embedding: "Embeddings" };
  const selectedParse = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId);
  const selectedChunk = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId);
  const selectedEmbedding = activeDocument?.embeddingRuns.find((run) => run.id === selectedEmbeddingRunId);
  const isHistorical = Boolean(selectedParse?.historicalLineage || selectedChunk?.historicalLineage || selectedEmbedding?.historicalLineage);

  return (
    <section className="border-b bg-white px-4 py-2 sm:px-7" data-testid="pipeline-context-bar">
      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
        <FileText aria-hidden="true" className="size-4 shrink-0 text-slate-500" />
        <Select disabled={persistenceStatus !== "available" || documents.length === 0} onValueChange={(value) => void selectPersistedDocument(value)} value={activeDocumentId ?? ""}>
          <SelectTrigger aria-label={labels.document} className="h-8 min-w-0 max-w-[17rem] border-0 px-1 text-xs font-medium shadow-none"><SelectValue placeholder={documentName ?? (documents.length ? labels.placeholder : labels.noDocument)} /></SelectTrigger>
          <SelectContent>{documents.map((document) => <SelectItem key={document.id} value={document.id}>{document.fileName}</SelectItem>)}</SelectContent>
        </Select>
        <Select disabled={!activeDocumentId || pipelines.length === 0} onValueChange={(value) => void selectPipeline(value)} value={activePipelineId ?? ""}>
          <SelectTrigger aria-label={labels.pipeline} className="h-8 min-w-[10rem] max-w-[16rem] border-0 px-1 text-xs font-semibold shadow-none"><SelectValue placeholder={pipelines.length ? labels.pipeline : labels.noPipeline} /></SelectTrigger>
          <SelectContent>{pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}{pipeline.isDefault ? " · default" : ""}</SelectItem>)}</SelectContent>
        </Select>
        <span aria-label={preferences.locale === "tr" ? "Seçili lineage" : "Selected lineage"} className="shrink-0 text-xs font-semibold tracking-wide text-slate-700">
          <Link className="hover:underline" href="/parse" title={selectedParse?.id}>{labels.parse} {parseNumber ?? "—"}</Link><span className="px-1 text-slate-400">→</span><Link className="hover:underline" href="/chunking" title={selectedChunk?.id}>{labels.chunk} {chunkNumber ?? "—"}</Link><span className="px-1 text-slate-400">→</span><Link className="hover:underline" href="/embeddings" title={selectedEmbedding?.id}>{labels.embedding} {embeddingNumber ?? "—"}</Link>
        </span>
        {isHistorical ? <span className="truncate text-[10px] text-amber-700">({labels.historical})</span> : null}
      </div>
    </section>
  );
}
