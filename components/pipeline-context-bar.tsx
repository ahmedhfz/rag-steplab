"use client";

import Link from "next/link";
import { FileText } from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RunSummary } from "@/lib/rag-api-types";
import { UI_COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

type PipelineStage = {
  href: string;
  label: string;
  run: RunSummary | undefined;
};

function shortRunId(run: RunSummary | undefined) {
  if (!run) return "—";
  return run.id.length > 14 ? `${run.id.slice(0, 12)}…` : run.id;
}

function StageLink({ stage, locale }: { stage: PipelineStage; locale: "en" | "tr" }) {
  return (
    <Link className="min-w-[136px] flex-1 rounded-md border px-3 py-2 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400" href={stage.href}>
      <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{stage.label}</span>
      <span className="mt-1 block truncate font-mono text-xs text-slate-700" title={stage.run?.id}>{shortRunId(stage.run)}</span>
      <span className="mt-1 block text-[11px] text-slate-500">{stage.run ? (locale === "tr" ? "Seçili" : "Selected") : (locale === "tr" ? "Seçim yok" : "Not selected")}</span>
    </Link>
  );
}

export function PipelineContextBar() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const {
    documents,
    activeDocument,
    selectedParseRunId,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    persistenceStatus,
    selectPersistedDocument,
  } = useDocumentPipeline();
  const selectedParse = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId);
  const selectedChunk = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId);
  const selectedEmbedding = activeDocument?.embeddingRuns.find((run) => run.id === selectedEmbeddingRunId);
  const hasHistoricalSelection = Boolean(selectedParse?.historicalLineage || selectedChunk?.historicalLineage || selectedEmbedding?.historicalLineage);
  const labels = preferences.locale === "tr"
    ? { document: "Aktif doküman", placeholder: "Doküman seçin", lineage: "Seçili pipeline lineage", historical: "Historical lineage", noDocument: "Aktif doküman yok" }
    : { document: "Active document", placeholder: "Select a document", lineage: "Selected pipeline lineage", historical: "Historical lineage", noDocument: "No active document" };
  const stages: PipelineStage[] = [
    { href: "/parse", label: copy.nav.parse, run: selectedParse },
    { href: "/chunking", label: copy.nav.chunking, run: selectedChunk },
    { href: "/embeddings", label: copy.nav.embeddings, run: selectedEmbedding },
  ];

  return (
    <section className="border-b bg-white px-4 py-4 sm:px-7" data-testid="pipeline-context-bar">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500"><FileText aria-hidden="true" className="size-3.5" />{labels.document}</div>
          <Select disabled={persistenceStatus !== "available" || documents.length === 0} onValueChange={(value) => void selectPersistedDocument(value)} value={activeDocument?.id ?? undefined}>
            <SelectTrigger aria-label={labels.document} className="mt-2 max-w-xl"><SelectValue placeholder={activeDocument?.fileName ?? (documents.length ? labels.placeholder : labels.noDocument)} /></SelectTrigger>
            <SelectContent>{documents.map((document) => <SelectItem key={document.id} value={document.id}>{document.fileName}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="min-w-0 flex-[2]">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
            <span>{labels.lineage}</span>
            {hasHistoricalSelection ? <Badge className="rounded-md border-amber-200 bg-amber-50 text-amber-700" variant="outline">{labels.historical}</Badge> : null}
          </div>
          <div className={cn("flex gap-2 overflow-x-auto pb-1", !activeDocument && "opacity-70")}>
            {stages.map((stage) => <StageLink key={stage.href} locale={preferences.locale} stage={stage} />)}
          </div>
        </div>
      </div>
    </section>
  );
}
