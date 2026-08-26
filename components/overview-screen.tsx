"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, ArrowUpDown, BarChart3, Blocks, Braces, CircleEllipsis, Database, FileText, Grid2X2, ListFilter, Search, type LucideIcon } from "lucide-react";

import { useDocumentPipeline, type PipelineOperationStatus } from "@/components/document-pipeline-provider";
import { EmptyPipelineState, PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { StatusIndicator } from "@/components/status-indicator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type AppCopy, UI_COPY } from "@/lib/copy";
import { blocker, type BlockerCode } from "@/lib/blockers";
import type { ExperimentSummary } from "@/lib/rag-api-types";
import type { PipelineStepDefinition, PipelineStepKey, PipelineStepState } from "@/lib/rag-ui-types";
import { cn } from "@/lib/utils";

const pipelineSteps: PipelineStepDefinition[] = [
  { key: "document", icon: "document" }, { key: "parse", icon: "parse" },
  { key: "chunk", icon: "chunk" }, { key: "embed", icon: "embed" },
  { key: "retrieve", icon: "retrieve" },
  { key: "rerank", icon: "rerank" }, { key: "context", icon: "context" },
  { key: "generate", icon: "generate" }, { key: "evaluate", icon: "evaluate" },
];

const stageHref: Record<PipelineStepKey, string> = {
  document: "/documents", parse: "/parse", chunk: "/chunking", embed: "/embeddings", index: "/embeddings",
  retrieve: "/playground", rerank: "/playground", context: "/playground", generate: "/playground", evaluate: "/evaluation",
};

const pipelineIcons: Record<PipelineStepKey, LucideIcon> = {
  document: FileText, parse: ListFilter, chunk: Grid2X2, embed: Braces, index: Database,
  retrieve: Search, rerank: ArrowUpDown, context: Blocks, generate: CircleEllipsis, evaluate: BarChart3,
};

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

function operationState(status: PipelineOperationStatus): PipelineStepState {
  if (status === "processing") return "Processing";
  if (status === "error") return "Error";
  if (status === "completed") return "Completed";
  if (status === "ready") return "Ready";
  if (status === "stale") return "Stale";
  return "Locked";
}

function experimentStageState(experiment: ExperimentSummary | undefined, stage: "retrieval" | "reranking" | "context" | "generation", enabled: boolean): PipelineStepState {
  if (!enabled) return "Locked";
  const status = experiment?.stageStatuses[stage];
  if (status === "skipped") return "Skipped";
  if (status === "completed") return "Completed";
  if (!experiment) return stage === "retrieval" ? "Ready" : "Locked";
  const order = ["retrieval", "reranking", "context", "generation"] as const;
  if (order.find((key) => !experiment.stageStatuses[key]) !== stage) return "Locked";
  if (experiment.status === "running" || experiment.status === "queued") return "Processing";
  if (experiment.status === "failed") return "Error";
  return "Ready";
}

function JourneyStep({ copy, href, index, reason, state, step }: { copy: AppCopy; href: string; index: number; reason: string | null; state: PipelineStepState; step: PipelineStepDefinition }) {
  const Icon = pipelineIcons[step.icon];
  const cardClass = cn(
    "relative z-10 flex min-h-[116px] min-w-0 flex-col justify-between border bg-white p-3 text-left transition-colors",
    state === "Completed" && "border-[#d8b5c2] bg-[#fbf4f6]",
    state === "Processing" && "border-[#eadfc9] bg-[#fffaf1]",
    state === "Error" && "border-[#edcfcf] bg-[#fbefef]",
    state === "Locked" && "border-[#e7e2e4] bg-[#f7f5f6]",
    reason ? "cursor-not-allowed" : "hover:border-[#c697a9] hover:bg-[#fbf4f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25",
  );
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-full border text-[11px] font-semibold", state === "Completed" ? "border-[#d8b5c2] bg-white text-[#711f3a]" : "border-[#d8d2d5] text-[#6e676a]")}>{index + 1}</span>
        <Icon aria-hidden="true" className={cn("size-4 shrink-0 stroke-[1.6]", state === "Completed" ? "text-[#711f3a]" : "text-[#6e676a]")} />
      </div>
      <div className="mt-3 min-w-0">
        <span className="block truncate text-xs font-semibold text-[#171416]">{copy.overview.steps[step.key]}</span>
        <span className="mt-2 block"><StatusIndicator state={state} /></span>
        {reason ? <span className="mt-2 block text-[10px] leading-4 text-[#8d651e]">{reason}</span> : null}
      </div>
    </>
  );

  return <motion.div animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 4 }} key={step.key} transition={{ duration: 0.18, delay: index * 0.02, ease: "easeOut" }}>{reason ? <div aria-disabled="true" className={cardClass}>{content}</div> : <Link className={cardClass} href={href}>{content}</Link>}</motion.div>;
}

export function OverviewScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const {
    documents, activeDocumentId, activeDocument, persistenceStatus, persistenceError, selectedParseRunId, selectedChunkRunId,
    selectedEmbeddingRunId, chunkStatus, embeddingStatus, pipelines, activePipelineId,
    activePipeline, selectPersistedDocument, selectPipeline, createPipeline, renamePipeline, deletePipeline,
  } = useDocumentPipeline();
  const [editing, setEditing] = useState<"create" | "rename" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pipelineName, setPipelineName] = useState("");
  const labels = preferences.locale === "tr" ? {
    description: "Seçili dokümanın gerçek RAG lineage’ını ve adım durumlarını inceleyin.", document: "Doküman", chooseDocument: "Doküman seçin",
    pipeline: "Indexing pipeline", noPipeline: "Indexing pipeline seçin", newPipeline: "Yeni", rename: "Yeniden adlandır", remove: "Sil",
    save: "Kaydet", cancel: "Vazgeç", namePlaceholder: "Pipeline adı", lineage: "Seçili lineage", continue: "Devam et",
    empty: "Henüz doküman yok. RAG akışına başlamak için Documents ekranından bir PDF ekleyin.", documentsCta: "Dokümanlara git",
    confirmDelete: "Bu pipeline silinsin mi? Artifact’lar silinmez.",
    loading: "Doküman workspace’i yükleniyor…", unavailable: "Doküman servisi kullanılamıyor.",
  } : {
    description: "Inspect the selected document's real RAG lineage and stage states.", document: "Document", chooseDocument: "Select a document",
    pipeline: "Indexing pipeline", noPipeline: "Select an indexing pipeline", newPipeline: "New", rename: "Rename", remove: "Delete",
    save: "Save", cancel: "Cancel", namePlaceholder: "Pipeline name", lineage: "Selected lineage", continue: "Continue",
    empty: "No documents yet. Add a PDF from Documents to begin the RAG flow.", documentsCta: "Go to Documents",
    confirmDelete: "Delete this pipeline? Artifacts will not be deleted.",
    loading: "Loading document workspace…", unavailable: "The document service is unavailable.",
  };

  const matchingExperiment = activeDocument?.experiments.find((run) => run.isCompatible && run.chunkRunId === selectedChunkRunId && (run.embeddingRunId === null || run.embeddingRunId === selectedEmbeddingRunId));
  const matchingDatasetIds = new Set(activeDocument?.evaluationDatasets.filter((dataset) => dataset.parseRunId === selectedParseRunId).map((dataset) => dataset.id) ?? []);
  const matchingEvaluation = activeDocument?.evaluationRuns.find((run) => matchingDatasetIds.has(run.datasetId) && run.chunkRunId === selectedChunkRunId && run.embeddingRunId === selectedEmbeddingRunId);
  const parseSummary = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId);
  const chunkSummary = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId);
  const embeddingSummary = activeDocument?.embeddingRuns.find((run) => run.id === selectedEmbeddingRunId);
  const hasDocument = Boolean(activeDocumentId);
  const parseState: PipelineStepState = !hasDocument ? "Locked" : parseSummary?.status === "completed" && parseSummary.isCompatible ? "Completed" : activeDocument?.parseRuns.some((run) => run.status === "queued" || run.status === "running") ? "Processing" : activeDocument?.parseRuns[0]?.status === "failed" ? "Error" : "Ready";
  const chunkState = chunkSummary?.status === "completed" && chunkSummary.isCompatible ? "Completed" : operationState(chunkStatus);
  const embeddingState = embeddingSummary?.status === "completed" && embeddingSummary.isCompatible ? "Completed" : operationState(embeddingStatus);
  const evaluationState: PipelineStepState = matchingEvaluation ? matchingEvaluation.status === "completed" ? "Completed" : matchingEvaluation.status === "running" || matchingEvaluation.status === "queued" ? "Processing" : "Error" : selectedChunkRunId && selectedEmbeddingRunId && matchingDatasetIds.size > 0 ? "Ready" : "Locked";
  const pipelineState: Record<PipelineStepKey, PipelineStepState> = {
    document: hasDocument ? "Completed" : "Not started", parse: parseState, chunk: chunkState, embed: embeddingState, index: embeddingState,
    retrieve: experimentStageState(matchingExperiment, "retrieval", Boolean(selectedChunkRunId)),
    rerank: experimentStageState(matchingExperiment, "reranking", Boolean(selectedChunkRunId)),
    context: experimentStageState(matchingExperiment, "context", Boolean(selectedChunkRunId)),
    generate: experimentStageState(matchingExperiment, "generation", Boolean(selectedChunkRunId)), evaluate: evaluationState,
  };
  const parseNumber = runNumber(activeDocument?.parseRuns ?? [], selectedParseRunId);
  const chunkNumber = runNumber(activeDocument?.chunkRuns ?? [], selectedChunkRunId);
  const embeddingNumber = runNumber(activeDocument?.embeddingRuns ?? [], selectedEmbeddingRunId);
  const continueHref = !selectedParseRunId ? "/parse" : !selectedChunkRunId ? "/chunking" : !selectedEmbeddingRunId ? "/embeddings" : "/playground";
  const groupLabels = preferences.locale === "tr"
    ? { knowledge: "Hazırla", query: "Test et", quality: "Ölç" }
    : { knowledge: "Prepare", query: "Test", quality: "Measure" };

  function lockedReason(step: PipelineStepKey): string | null {
    if (pipelineState[step] !== "Locked") return null;
    let code: BlockerCode = "missing_experiment";
    if (!hasDocument) code = "missing_document";
    else if (step === "chunk" && !selectedParseRunId) code = "missing_parse";
    else if ((step === "embed" || step === "index" || step === "retrieve") && !selectedChunkRunId) code = "missing_chunk";
    else if (step === "evaluate" && matchingDatasetIds.size === 0) code = "missing_dataset";
    return blocker(preferences.locale, code).message;
  }

  async function savePipelineName() {
    const name = pipelineName.trim();
    if (!name) return;
    if (editing === "create") await createPipeline(name);
    if (editing === "rename" && activePipeline) await renamePipeline(activePipeline.id, name);
    setEditing(null);
    setPipelineName("");
  }

  return (
    <div className="min-w-0 overflow-x-clip">
      <header className="border-b bg-white px-4 py-8 sm:px-8 sm:py-9">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#969093]">{copy.nav.overview}</div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div><h1 className="text-[28px] font-semibold tracking-[-0.045em]">{copy.overview.title}</h1><p className="mt-2 max-w-2xl text-sm leading-5 text-[#6e676a]">{labels.description}</p></div>
          {activeDocument ? <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#d8b5c2] bg-[#fbf4f6] px-3 py-1.5 text-xs font-medium text-[#711f3a]"><FileText aria-hidden="true" className="size-3.5" /><span className="max-w-[220px] truncate">{activeDocument.fileName}</span></span> : null}
        </div>
      </header>

      <section className="px-4 py-6 sm:px-8 sm:py-7">
        <div className="overflow-hidden border border-[#e7e2e4] bg-white" data-testid="overview-journey">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e7e2e4] px-4 py-4 sm:px-6">
            <div><h2 className="text-sm font-semibold">{preferences.locale === "tr" ? "RAG yolculuğu" : "RAG journey"}</h2><p className="mt-1 text-xs leading-5 text-[#6e676a]">{preferences.locale === "tr" ? "Dokümandan değerlendirmeye tek bir bağlı akış." : "One connected flow from document to evaluation."}</p></div>
            <span className="text-xs text-[#969093]">{activePipeline?.name ?? labels.noPipeline}</span>
          </div>
          <div className="relative p-4 sm:p-6">
            <svg aria-hidden="true" className="pointer-events-none absolute left-8 right-8 top-[117px] hidden h-9 w-[calc(100%-4rem)] lg:block" preserveAspectRatio="none" viewBox="0 0 1000 36">
              <path d="M4 21 C42 4 70 4 108 20 S174 37 214 19 S278 4 324 20 S394 37 438 19 S510 4 552 20 S624 37 666 19 S738 4 780 20 S852 37 896 19 S950 9 996 18" fill="none" stroke="#d8d2d5" strokeLinecap="round" strokeWidth="2" />
              <path d="M4 21 C42 4 70 4 108 20" fill="none" stroke="#711f3a" strokeLinecap="round" strokeWidth="2" />
            </svg>
            <div className="relative mb-4 hidden grid-cols-9 gap-2 lg:grid">
              <div className="col-span-4 border-l-2 border-[#711f3a] pl-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#711f3a]">{groupLabels.knowledge}</div>
              <div className="col-span-4 border-l-2 border-[#d8b5c2] pl-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#711f3a]">{groupLabels.query}</div>
              <div className="col-span-1 border-l-2 border-[#d8b5c2] pl-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#711f3a]">{groupLabels.quality}</div>
            </div>
            <div className="relative grid gap-2 sm:grid-cols-2 lg:grid-cols-9">
              {pipelineSteps.map((step, index) => <JourneyStep copy={copy} href={stageHref[step.key]} index={index} key={step.key} reason={lockedReason(step.key)} state={pipelineState[step.key]} step={step} />)}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t px-4 py-6 sm:px-8">
        {persistenceStatus === "checking" ? <EmptyPipelineState>{labels.loading}</EmptyPipelineState>
          : persistenceStatus === "unavailable" ? <><EmptyPipelineState>{labels.unavailable}</EmptyPipelineState><PipelineErrorMessage message={persistenceError?.message} /></>
            : documents.length === 0 ? (
          <div className="border border-dashed border-[#d8d2d5] bg-white px-5 py-10 text-center"><p className="text-sm text-[#6e676a]">{labels.empty}</p><Button asChild className="mt-4" variant="outline"><Link href="/documents">{labels.documentsCta}</Link></Button></div>
            ) : (
          <div className="border border-[#e7e2e4] bg-white p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e7e2e4] pb-4"><div><h2 className="text-sm font-semibold">{preferences.locale === "tr" ? "Çalışma alanı bağlamı" : "Workspace context"}</h2><p className="mt-1 text-xs leading-5 text-[#6e676a]">{preferences.locale === "tr" ? "Doküman ve indexing pipeline seçiminizi yönetin." : "Manage the document and indexing pipeline selection."}</p></div><span className="rounded-full border border-[#d8b5c2] bg-[#fbf4f6] px-2.5 py-1 text-[11px] font-medium text-[#711f3a]">{activeDocument?.fileName ?? labels.chooseDocument}</span></div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-[#171416]" htmlFor="overview-document">{labels.document}</label>
                <Select onValueChange={(value) => void selectPersistedDocument(value)} value={activeDocumentId ?? ""}><SelectTrigger className="mt-2 w-full" id="overview-document"><SelectValue placeholder={labels.chooseDocument} /></SelectTrigger><SelectContent>{documents.map((document) => <SelectItem key={document.id} value={document.id}>{document.fileName}</SelectItem>)}</SelectContent></Select>
              </div>
              <div>
                <label className="text-xs font-medium text-[#171416]" htmlFor="overview-pipeline">{labels.pipeline}</label>
                <Select onValueChange={(value) => void selectPipeline(value === "none" ? null : value)} value={activePipelineId ?? "none"}><SelectTrigger className="mt-2 w-full" id="overview-pipeline"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{labels.noPipeline}</SelectItem>{pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}</SelectContent></Select>
                <div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => { setEditing("create"); setPipelineName(""); }} size="sm" variant="secondary">{labels.newPipeline}</Button><Button disabled={!activePipeline} onClick={() => { setEditing("rename"); setPipelineName(activePipeline?.name ?? ""); }} size="sm" variant="ghost">{labels.rename}</Button><Button disabled={!activePipeline} onClick={() => setConfirmDelete(true)} size="sm" variant="ghost">{labels.remove}</Button></div>
                {editing ? <div className="mt-3 flex flex-wrap gap-2"><Input aria-label={labels.namePlaceholder} className="min-w-[180px] flex-1" maxLength={100} onChange={(event) => setPipelineName(event.target.value)} placeholder={labels.namePlaceholder} value={pipelineName} /><Button disabled={!pipelineName.trim()} onClick={() => void savePipelineName()} size="sm">{labels.save}</Button><Button onClick={() => setEditing(null)} size="sm" variant="ghost">{labels.cancel}</Button></div> : null}
                {confirmDelete && activePipeline ? <div aria-labelledby="delete-pipeline-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-[#171416]/30 p-4" role="dialog"><div className="w-full max-w-sm border border-[#e7e2e4] bg-white p-5 shadow-xl"><h2 className="text-sm font-semibold" id="delete-pipeline-title">{labels.remove}</h2><p className="mt-2 text-sm leading-5 text-[#6e676a]">{labels.confirmDelete}</p><div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirmDelete(false)} variant="outline">{labels.cancel}</Button><Button onClick={() => { void deletePipeline(activePipeline.id); setConfirmDelete(false); }} variant="destructive">{labels.remove}</Button></div></div></div> : null}
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-[#e7e2e4] pt-5"><div><p className="text-xs text-[#969093]">{labels.lineage}</p><p className="mt-1 font-semibold tracking-wide text-[#501329]">{preferences.locale === "tr" ? "Ayrıştırma" : "Parsing"} {parseNumber ?? "—"} → {preferences.locale === "tr" ? "Parçalama" : "Chunking"} {chunkNumber ?? "—"} → {preferences.locale === "tr" ? "Gömme" : "Embeddings"} {embeddingNumber ?? "—"}</p></div><Button asChild><Link href={continueHref}>{labels.continue}<ArrowRight aria-hidden="true" /></Link></Button></div>
          </div>
            )}
      </section>
    </div>
  );
}
