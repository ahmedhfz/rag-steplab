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
import { UI_COPY } from "@/lib/copy";
import { blocker, type BlockerCode } from "@/lib/blockers";
import type { ExperimentSummary } from "@/lib/rag-api-types";
import type { PipelineStepDefinition, PipelineStepKey, PipelineStepState } from "@/lib/rag-ui-types";

const pipelineSteps: PipelineStepDefinition[] = [
  { key: "document", icon: "document" }, { key: "parse", icon: "parse" },
  { key: "chunk", icon: "chunk" }, { key: "embed", icon: "embed" },
  { key: "retrieve", icon: "retrieve" },
  { key: "rerank", icon: "rerank" }, { key: "context", icon: "context" },
  { key: "generate", icon: "generate" }, { key: "evaluate", icon: "evaluate" },
];

const pipelineGroups: Array<{ key: "knowledge" | "query" | "quality"; steps: PipelineStepKey[] }> = [
  { key: "knowledge", steps: ["document", "parse", "chunk", "embed"] },
  { key: "query", steps: ["retrieve", "rerank", "context", "generate"] },
  { key: "quality", steps: ["evaluate"] },
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
    ? { knowledge: "Bilgi hazırlama / indexing", query: "Sorgu pipeline'ı", quality: "Kalite" }
    : { knowledge: "Knowledge preparation / indexing", query: "Query pipeline", quality: "Quality" };

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
    <div>
      <section className="px-4 py-7 sm:px-8 sm:py-9">
        <h1 className="text-[22px] font-semibold tracking-[-0.025em]">{copy.overview.title}</h1>
        <p className="mt-2 text-sm text-slate-600">{labels.description}</p>
        <div className="mt-7 grid gap-4 lg:grid-cols-[1fr_1fr_0.42fr]">
          {pipelineGroups.map((group, groupIndex) => (
            <section className="border p-3" key={group.key}>
              <h2 className="border-l-2 border-sky-300 pl-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{groupLabels[group.key]}</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                {group.steps.map((stepKey, stepIndex) => {
                  const step = pipelineSteps.find((item) => item.key === stepKey)!;
                  const Icon = pipelineIcons[step.icon];
                  const reason = lockedReason(step.key);
                  const content = <><span className="grid size-8 shrink-0 place-items-center rounded-full border bg-white text-xs font-semibold">{pipelineSteps.findIndex((item) => item.key === step.key) + 1}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-sm font-medium"><Icon aria-hidden="true" className="size-4 stroke-[1.5]" />{copy.overview.steps[step.key]}</span><span className="mt-1 block"><StatusIndicator state={pipelineState[step.key]} /></span>{reason ? <span className="mt-2 block text-[10px] leading-4 text-amber-800">{reason}</span> : null}</span></>;
                  return <motion.div animate={{ opacity: 1, transform: "translateY(0px)" }} initial={{ opacity: 0, transform: "translateY(4px)" }} key={step.key} transition={{ duration: 0.18, delay: (groupIndex * 4 + stepIndex) * 0.02, ease: "easeOut" }}>{reason ? <div aria-disabled="true" className="flex min-h-20 items-start gap-3 border bg-slate-50 p-3">{content}</div> : <Link className="flex min-h-20 items-start gap-3 border p-3 transition-colors hover:border-sky-300 hover:bg-sky-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500" href={stageHref[step.key]}>{content}</Link>}</motion.div>;
                })}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="border-t px-4 py-6 sm:px-8">
        {persistenceStatus === "checking" ? <EmptyPipelineState>{labels.loading}</EmptyPipelineState>
          : persistenceStatus === "unavailable" ? <><EmptyPipelineState>{labels.unavailable}</EmptyPipelineState><PipelineErrorMessage message={persistenceError?.message} /></>
            : documents.length === 0 ? (
          <div className="border px-5 py-8 text-center"><p className="text-sm text-slate-600">{labels.empty}</p><Button asChild className="mt-4" variant="outline"><Link href="/documents">{labels.documentsCta}</Link></Button></div>
            ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-600" htmlFor="overview-document">{labels.document}</label>
              <Select onValueChange={(value) => void selectPersistedDocument(value)} value={activeDocumentId ?? undefined}><SelectTrigger className="mt-2 w-full" id="overview-document"><SelectValue placeholder={labels.chooseDocument} /></SelectTrigger><SelectContent>{documents.map((document) => <SelectItem key={document.id} value={document.id}>{document.fileName}</SelectItem>)}</SelectContent></Select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600" htmlFor="overview-pipeline">{labels.pipeline}</label>
              <Select onValueChange={(value) => void selectPipeline(value === "none" ? null : value)} value={activePipelineId ?? "none"}><SelectTrigger className="mt-2 w-full" id="overview-pipeline"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{labels.noPipeline}</SelectItem>{pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}</SelectContent></Select>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button onClick={() => { setEditing("create"); setPipelineName(""); }} size="sm" variant="secondary">{labels.newPipeline}</Button>
                <Button disabled={!activePipeline} onClick={() => { setEditing("rename"); setPipelineName(activePipeline?.name ?? ""); }} size="sm" variant="ghost">{labels.rename}</Button>
                <Button disabled={!activePipeline} onClick={() => setConfirmDelete(true)} size="sm" variant="ghost">{labels.remove}</Button>
              </div>
              {editing ? <div className="mt-3 flex gap-2"><Input aria-label={labels.namePlaceholder} maxLength={100} onChange={(event) => setPipelineName(event.target.value)} placeholder={labels.namePlaceholder} value={pipelineName} /><Button disabled={!pipelineName.trim()} onClick={() => void savePipelineName()} size="sm">{labels.save}</Button><Button onClick={() => setEditing(null)} size="sm" variant="ghost">{labels.cancel}</Button></div> : null}
              {confirmDelete && activePipeline ? <div aria-labelledby="delete-pipeline-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4" role="dialog"><div className="w-full max-w-sm border bg-white p-5 shadow-xl"><h2 className="text-sm font-semibold" id="delete-pipeline-title">{labels.remove}</h2><p className="mt-2 text-sm leading-5 text-slate-600">{labels.confirmDelete}</p><div className="mt-5 flex justify-end gap-2"><Button onClick={() => setConfirmDelete(false)} variant="outline">{labels.cancel}</Button><Button onClick={() => { void deletePipeline(activePipeline.id); setConfirmDelete(false); }} variant="destructive">{labels.remove}</Button></div></div></div> : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5 lg:col-span-2">
              <div><p className="text-xs text-slate-500">{labels.lineage}</p><p className="mt-1 font-semibold tracking-wide">P{parseNumber ?? "—"} → C{chunkNumber ?? "—"} → E{embeddingNumber ?? "—"}</p></div>
              <Button asChild><Link href={continueHref}>{labels.continue}<ArrowRight aria-hidden="true" /></Link></Button>
            </div>
          </div>
            )}
      </section>
    </div>
  );
}
