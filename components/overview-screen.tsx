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
import type { ExperimentSummary } from "@/lib/rag-api-types";
import type { PipelineStepDefinition, PipelineStepKey, PipelineStepState } from "@/lib/rag-ui-types";

const pipelineSteps: PipelineStepDefinition[] = [
  { key: "document", icon: "document" }, { key: "parse", icon: "parse" },
  { key: "chunk", icon: "chunk" }, { key: "embed", icon: "embed" },
  { key: "index", icon: "index" }, { key: "retrieve", icon: "retrieve" },
  { key: "rerank", icon: "rerank" }, { key: "context", icon: "context" },
  { key: "generate", icon: "generate" }, { key: "evaluate", icon: "evaluate" },
];

const pipelineIcons: Record<PipelineStepKey, LucideIcon> = {
  document: FileText, parse: ListFilter, chunk: Grid2X2, embed: Braces, index: Database,
  retrieve: Search, rerank: ArrowUpDown, context: Blocks, generate: CircleEllipsis, evaluate: BarChart3,
};

function runNumber(runs: Array<{ id: string }>, id: string | null) {
  const index = id ? runs.findIndex((run) => run.id === id) : -1;
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
  const [pipelineName, setPipelineName] = useState("");
  const labels = preferences.locale === "tr" ? {
    description: "Seçili dokümanın gerçek RAG lineage’ını ve adım durumlarını inceleyin.", document: "Doküman", chooseDocument: "Doküman seçin",
    pipeline: "Pipeline", noPipeline: "Pipeline yok (yerel çalışma alanı)", newPipeline: "Yeni", rename: "Yeniden adlandır", remove: "Sil",
    save: "Kaydet", cancel: "Vazgeç", namePlaceholder: "Pipeline adı", lineage: "Seçili lineage", continue: "Devam et",
    empty: "Henüz doküman yok. RAG akışına başlamak için Documents ekranından bir PDF ekleyin.", documentsCta: "Dokümanlara git",
    confirmDelete: "Bu pipeline silinsin mi? Artifact’lar silinmez.",
    loading: "Doküman workspace’i yükleniyor…", unavailable: "Doküman servisi kullanılamıyor.",
  } : {
    description: "Inspect the selected document's real RAG lineage and stage states.", document: "Document", chooseDocument: "Select a document",
    pipeline: "Pipeline", noPipeline: "No pipeline (local workspace)", newPipeline: "New", rename: "Rename", remove: "Delete",
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
        <div className="technical-scrollbar mt-7 overflow-x-auto pb-3">
          <div className="flex min-w-[1180px] items-start">
            {pipelineSteps.map((step, index) => {
              const Icon = pipelineIcons[step.icon];
              return (
                <motion.div animate={{ opacity: 1, transform: "translateY(0px)" }} className="flex flex-1 items-center" initial={{ opacity: 0, transform: "translateY(5px)" }} key={step.key} transition={{ duration: 0.18, delay: index * 0.025, ease: "easeOut" }}>
                  <div className="flex min-w-[96px] flex-col items-center text-center">
                    <span className="grid size-8 place-items-center rounded-full border bg-white text-xs font-semibold">{index + 1}</span>
                    <Icon aria-hidden="true" className="mt-5 size-8 stroke-[1.5] text-slate-700" />
                    <span className="mt-3 text-sm font-medium">{copy.overview.steps[step.key]}</span>
                    <span className="mt-4"><StatusIndicator state={pipelineState[step.key]} /></span>
                  </div>
                  {index < pipelineSteps.length - 1 && <ArrowRight aria-hidden="true" className="mx-1 mt-[68px] size-4 shrink-0 text-slate-400" />}
                </motion.div>
              );
            })}
          </div>
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
                <Button disabled={!activePipeline} onClick={() => { if (activePipeline && window.confirm(labels.confirmDelete)) void deletePipeline(activePipeline.id); }} size="sm" variant="ghost">{labels.remove}</Button>
              </div>
              {editing ? <div className="mt-3 flex gap-2"><Input aria-label={labels.namePlaceholder} maxLength={100} onChange={(event) => setPipelineName(event.target.value)} placeholder={labels.namePlaceholder} value={pipelineName} /><Button disabled={!pipelineName.trim()} onClick={() => void savePipelineName()} size="sm">{labels.save}</Button><Button onClick={() => setEditing(null)} size="sm" variant="ghost">{labels.cancel}</Button></div> : null}
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
