"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  ArrowUpDown,
  BarChart3,
  Blocks,
  BookOpen,
  Braces,
  CircleEllipsis,
  Database,
  FileText,
  Grid2X2,
  ListFilter,
  Search,
  type LucideIcon,
} from "lucide-react";

import { useDocumentPipeline, type PipelineOperationStatus } from "@/components/document-pipeline-provider";
import { EmptyPipelineState, PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { StatusIndicator } from "@/components/status-indicator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UI_COPY } from "@/lib/copy";
import { blocker, type BlockerCode } from "@/lib/blockers";
import type { ExperimentSummary, RunStatus } from "@/lib/rag-api-types";
import type { PipelineStepDefinition, PipelineStepKey, PipelineStepState } from "@/lib/rag-ui-types";
import { cn } from "@/lib/utils";

const pipelineSteps: PipelineStepDefinition[] = [
  { key: "document", icon: "document" },
  { key: "parse", icon: "parse" },
  { key: "chunk", icon: "chunk" },
  { key: "embed", icon: "embed" },
  { key: "retrieve", icon: "retrieve" },
  { key: "rerank", icon: "rerank" },
  { key: "context", icon: "context" },
  { key: "generate", icon: "generate" },
  { key: "evaluate", icon: "evaluate" },
];

const stageHref: Record<PipelineStepKey, string> = {
  document: "/documents",
  parse: "/parse",
  chunk: "/chunking",
  embed: "/embeddings",
  index: "/embeddings",
  retrieve: "/playground",
  rerank: "/playground",
  context: "/playground",
  generate: "/playground",
  evaluate: "/evaluation",
};

const pipelineIcons: Record<PipelineStepKey, LucideIcon> = {
  document: FileText,
  parse: ListFilter,
  chunk: Grid2X2,
  embed: Braces,
  index: Database,
  retrieve: Search,
  rerank: ArrowUpDown,
  context: Blocks,
  generate: CircleEllipsis,
  evaluate: BarChart3,
};

function operationState(status: PipelineOperationStatus): PipelineStepState {
  if (status === "processing") return "Processing";
  if (status === "error") return "Error";
  if (status === "completed") return "Completed";
  if (status === "ready") return "Ready";
  if (status === "stale") return "Stale";
  return "Locked";
}

function runState(status: RunStatus): PipelineStepState {
  if (status === "queued" || status === "running") return "Processing";
  if (status === "completed") return "Completed";
  return "Error";
}

function experimentStageState(
  experiment: ExperimentSummary | undefined,
  stage: "retrieval" | "reranking" | "context" | "generation",
  enabled: boolean,
): PipelineStepState {
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

function JourneyNode({
  href,
  index,
  labels,
  reason,
  state,
  step,
}: {
  href: string;
  index: number;
  labels: Record<PipelineStepKey, string>;
  reason: string | null;
  state: PipelineStepState;
  step: PipelineStepDefinition;
}) {
  const Icon = pipelineIcons[step.icon];
  const nodeClass = cn(
    "relative z-10 flex min-h-[108px] min-w-0 flex-col gap-2 rounded-[14px] border border-transparent bg-white/70 px-2.5 py-2.5 text-left transition-[background-color,border-color,box-shadow]",
    state === "Completed" && "border-[#ead6dd] bg-[#fffafb]",
    state === "Processing" && "border-[#eadfc9] bg-[#fffdf8]",
    state === "Error" && "border-[#edcfcf] bg-[#fffafa]",
    state === "Locked" && "bg-[#f8f7f7]/80",
    reason
      ? "cursor-not-allowed"
      : "hover:border-[#d8b5c2] hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25",
  );
  const content = (
    <>
      <div className="flex w-full items-start justify-between gap-1.5">
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full border bg-white text-[11px] font-semibold",
            state === "Completed" ? "border-[#d8b5c2] text-[#711f3a]" : "border-[#d8d2d5] text-[#6e676a]",
          )}
        >
          {index + 1}
        </span>
        <Icon
          aria-hidden="true"
          className={cn("mt-1 size-3.5 shrink-0 stroke-[1.6]", state === "Completed" ? "text-[#711f3a]" : "text-[#6e676a]")}
        />
      </div>
      <div className="min-w-0">
        <span className="block text-[11px] font-semibold leading-4 text-[#171416]">{labels[step.key]}</span>
        <span className="mt-1.5 block">
          <StatusIndicator compact={false} state={state} />
        </span>
        {reason ? <span className="mt-1.5 block text-[10px] leading-4 text-[#8d651e]">{reason}</span> : null}
      </div>
    </>
  );

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      initial={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.18, delay: index * 0.02, ease: "easeOut" }}
    >
      {reason ? (
        <div aria-disabled="true" className={nodeClass} data-testid={`overview-journey-node-${step.key}`}>
          {content}
        </div>
      ) : (
        <Link className={nodeClass} data-testid={`overview-journey-node-${step.key}`} href={href}>
          {content}
        </Link>
      )}
    </motion.div>
  );
}

type Continuation = {
  action: string;
  description: string;
  href: string;
  state: PipelineStepState;
  title: string;
};

function formatActivityDate(value: string | null | undefined, locale: "en" | "tr") {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(date);
}

export function OverviewScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const {
    documents,
    activeDocumentId,
    activeDocument,
    persistenceStatus,
    persistenceError,
    selectedParseRunId,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    chunkStatus,
    embeddingStatus,
    pipelines,
    activePipelineId,
    activePipeline,
    selectPersistedDocument,
    selectPipeline,
    createPipeline,
    renamePipeline,
    deletePipeline,
  } = useDocumentPipeline();
  const [editing, setEditing] = useState<"create" | "rename" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pipelineName, setPipelineName] = useState("");

  const labels = preferences.locale === "tr"
    ? {
        description: "Gerçek RAG akışınızı tek bir bağlı yolculukta takip edin.",
        continueEyebrow: "Kaldığınız yerden devam edin",
        startTitle: "Dokümanınızı hazırlayın",
        startDescription: "Gerçek RAG akışını başlatmak için önce bir PDF seçin.",
        parseTitle: "Dokümanı ayrıştırmaya devam edin",
        parseDescription: "Yapısal içeriği oluşturmak için PDF'i Docling ayrıştırıcısına gönderin.",
        chunkTitle: "Parçalarınızı oluşturun",
        chunkDescription: "Ayrıştırılmış içeriği bir chunking stratejisiyle deneyime hazırlayın.",
        embedTitle: "Embedding'leri oluşturun",
        embedDescription: "Parçaları Gemini embedding'leriyle searchable vector'lara dönüştürün.",
        playgroundTitle: "Gerçek bir RAG deneyi çalıştırın",
        playgroundDescription: "Getirme, bağlam ve grounded cevabı aynı deney içinde inceleyin.",
        processingTitle: "İşlem tamamlanana kadar bekleyin",
        processingDescription: "Gerçek worker çıktısı hazır olduğunda bir sonraki adıma devam edebilirsiniz.",
        reviewTitle: "Sonucu inceleyin",
        reviewDescription: "Devam etmeden önce mevcut adımın hata veya stale durumunu kontrol edin.",
        continueAction: "Devam et",
        chooseDocument: "Doküman seçin",
        currentSetup: "Mevcut kurulum",
        currentSetupDescription: "Aktif doküman ve en güncel uyumlu lineage.",
        document: "Doküman",
        pipeline: "Indexing pipeline",
        noPipeline: "Indexing pipeline seçin",
        latestParse: "Son ayrıştırma",
        currentChunking: "Mevcut parçalama",
        currentEmbedding: "Gemini Embedding",
        readyForPlayground: "Playground'a hazır",
        notAvailable: "Henüz hazır değil",
        managePipeline: "Doküman ve pipeline yönet",
        newPipeline: "Yeni",
        rename: "Yeniden adlandır",
        remove: "Sil",
        save: "Kaydet",
        cancel: "Vazgeç",
        namePlaceholder: "Pipeline adı",
        confirmDelete: "Bu pipeline silinsin mi? Artifact’lar silinmez.",
        recentActivity: "Son aktivite",
        noActivity: "Bu doküman için henüz kaydedilmiş aktivite yok.",
        noDocumentActivity: "Bir doküman seçtiğinizde son parse, chunking, embedding ve deney çalışmaları burada görünür.",
        activityParse: "Ayrıştırma",
        activityChunk: "Parçalama",
        activityEmbedding: "Embedding",
        activityExperiment: "RAG deneyi",
        activityEvaluation: "Değerlendirme",
        strategyFixed: "Sabit token",
        strategyRecursive: "Recursive",
        strategyStructure: "Yapı farkındalıklı",
        whyMatters: "Bu neden önemli?",
        whyMattersText: "RAG kalitesini tek bir sonuçtan değil, dokümandan cevaba uzanan her ara karardan öğrenirsiniz.",
        empty: "Henüz doküman yok. RAG akışına başlamak için Documents ekranından bir PDF ekleyin.",
        documentsCta: "Dokümanlara git",
        loading: "Doküman workspace’i yükleniyor…",
        unavailable: "Doküman servisi kullanılamıyor.",
        current: "Mevcut",
      }
    : {
        description: "Follow your real RAG flow as one connected journey.",
        continueEyebrow: "Continue where you left off",
        startTitle: "Prepare a document",
        startDescription: "Choose a PDF first to start the real RAG flow.",
        parseTitle: "Continue with parsing",
        parseDescription: "Send the PDF to the Docling parser to create structured content.",
        chunkTitle: "Create your chunks",
        chunkDescription: "Prepare parsed content for experiments with a chunking strategy.",
        embedTitle: "Create embeddings",
        embedDescription: "Turn chunks into searchable vectors with Gemini embeddings.",
        playgroundTitle: "Run a real RAG experiment",
        playgroundDescription: "Inspect retrieval, context, and the grounded answer in one experiment.",
        processingTitle: "Wait for the current step",
        processingDescription: "Continue when the real worker output is ready.",
        reviewTitle: "Review the current result",
        reviewDescription: "Check the current step's error or stale state before continuing.",
        continueAction: "Continue",
        chooseDocument: "Select a document",
        currentSetup: "Current setup",
        currentSetupDescription: "Active document and latest compatible lineage.",
        document: "Document",
        pipeline: "Indexing pipeline",
        noPipeline: "Select an indexing pipeline",
        latestParse: "Latest Parse",
        currentChunking: "Current Chunking",
        currentEmbedding: "Gemini Embedding",
        readyForPlayground: "Ready for Playground",
        notAvailable: "Not available yet",
        managePipeline: "Manage document and pipeline",
        newPipeline: "New",
        rename: "Rename",
        remove: "Delete",
        save: "Save",
        cancel: "Cancel",
        namePlaceholder: "Pipeline name",
        confirmDelete: "Delete this pipeline? Artifacts will not be deleted.",
        recentActivity: "Recent activity",
        noActivity: "No saved activity exists for this document yet.",
        noDocumentActivity: "Recent parsing, chunking, embedding, and experiment runs will appear here after you select a document.",
        activityParse: "Parsing",
        activityChunk: "Chunking",
        activityEmbedding: "Embedding",
        activityExperiment: "RAG experiment",
        activityEvaluation: "Evaluation",
        strategyFixed: "Fixed token",
        strategyRecursive: "Recursive",
        strategyStructure: "Structure-aware",
        whyMatters: "Why this matters",
        whyMattersText: "RAG quality is learned through every decision between the document and the answer, not from one final result alone.",
        empty: "No documents yet. Add a PDF from Documents to begin the RAG flow.",
        documentsCta: "Go to Documents",
        loading: "Loading document workspace…",
        unavailable: "The document service is unavailable.",
        current: "Current",
      };

  const matchingExperiment = activeDocument?.experiments.find(
    (run) => run.isCompatible && run.chunkRunId === selectedChunkRunId && (run.embeddingRunId === null || run.embeddingRunId === selectedEmbeddingRunId),
  );
  const matchingDatasetIds = new Set(
    activeDocument?.evaluationDatasets.filter((dataset) => dataset.parseRunId === selectedParseRunId).map((dataset) => dataset.id) ?? [],
  );
  const matchingEvaluation = activeDocument?.evaluationRuns.find(
    (run) => matchingDatasetIds.has(run.datasetId) && run.chunkRunId === selectedChunkRunId && run.embeddingRunId === selectedEmbeddingRunId,
  );
  const parseSummary = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId);
  const chunkSummary = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId);
  const embeddingSummary = activeDocument?.embeddingRuns.find((run) => run.id === selectedEmbeddingRunId);
  const hasDocument = Boolean(activeDocumentId);
  const parseState: PipelineStepState = !hasDocument
    ? "Locked"
    : parseSummary?.status === "completed" && parseSummary.isCompatible
      ? "Completed"
      : activeDocument?.parseRuns.some((run) => run.status === "queued" || run.status === "running")
        ? "Processing"
        : activeDocument?.parseRuns[0]?.status === "failed"
          ? "Error"
          : "Ready";
  const chunkState = chunkSummary?.status === "completed" && chunkSummary.isCompatible ? "Completed" : operationState(chunkStatus);
  const embeddingState = embeddingSummary?.status === "completed" && embeddingSummary.isCompatible ? "Completed" : operationState(embeddingStatus);
  const evaluationState: PipelineStepState = matchingEvaluation
    ? matchingEvaluation.status === "completed"
      ? "Completed"
      : matchingEvaluation.status === "running" || matchingEvaluation.status === "queued"
        ? "Processing"
        : "Error"
    : selectedChunkRunId && selectedEmbeddingRunId && matchingDatasetIds.size > 0
      ? "Ready"
      : "Locked";
  const pipelineState: Record<PipelineStepKey, PipelineStepState> = {
    document: hasDocument ? "Completed" : "Not started",
    parse: parseState,
    chunk: chunkState,
    embed: embeddingState,
    index: embeddingState,
    retrieve: experimentStageState(matchingExperiment, "retrieval", Boolean(selectedChunkRunId)),
    rerank: experimentStageState(matchingExperiment, "reranking", Boolean(selectedChunkRunId)),
    context: experimentStageState(matchingExperiment, "context", Boolean(selectedChunkRunId)),
    generate: experimentStageState(matchingExperiment, "generation", Boolean(selectedChunkRunId)),
    evaluate: evaluationState,
  };
  const continueHref = !selectedParseRunId ? "/parse" : !selectedChunkRunId ? "/chunking" : !selectedEmbeddingRunId ? "/embeddings" : "/playground";
  const continuation: Continuation = persistenceStatus === "checking"
    ? { action: labels.continueAction, description: labels.processingDescription, href: "/documents", state: "Processing", title: labels.processingTitle }
    : !activeDocument
      ? { action: labels.documentsCta, description: labels.startDescription, href: "/documents", state: "Ready", title: labels.startTitle }
      : parseState === "Processing"
        ? { action: labels.continueAction, description: labels.processingDescription, href: "/parse", state: "Processing", title: labels.processingTitle }
        : parseState === "Error"
          ? { action: labels.continueAction, description: labels.reviewDescription, href: "/parse", state: "Error", title: labels.reviewTitle }
          : !selectedParseRunId || parseState === "Ready"
            ? { action: labels.continueAction, description: labels.parseDescription, href: "/parse", state: "Ready", title: labels.parseTitle }
            : chunkState === "Processing"
              ? { action: labels.continueAction, description: labels.processingDescription, href: "/chunking", state: "Processing", title: labels.processingTitle }
              : chunkState === "Error" || chunkState === "Stale"
                ? { action: labels.continueAction, description: labels.reviewDescription, href: "/chunking", state: chunkState, title: labels.reviewTitle }
                : !selectedChunkRunId || chunkState === "Ready"
                  ? { action: labels.continueAction, description: labels.chunkDescription, href: "/chunking", state: "Ready", title: labels.chunkTitle }
                  : embeddingState === "Processing"
                    ? { action: labels.continueAction, description: labels.processingDescription, href: "/embeddings", state: "Processing", title: labels.processingTitle }
                    : embeddingState === "Error" || embeddingState === "Stale"
                      ? { action: labels.continueAction, description: labels.reviewDescription, href: "/embeddings", state: embeddingState, title: labels.reviewTitle }
                      : !selectedEmbeddingRunId || embeddingState === "Ready"
                        ? { action: labels.continueAction, description: labels.embedDescription, href: "/embeddings", state: "Ready", title: labels.embedTitle }
                        : { action: labels.continueAction, description: labels.playgroundDescription, href: continueHref, state: "Ready", title: labels.playgroundTitle };

  const journeyLabels: Record<PipelineStepKey, string> = {
    ...copy.overview.steps,
    embed: preferences.locale === "tr" ? "Embedding" : "Embeddings",
    retrieve: preferences.locale === "tr" ? "Getirme" : "Retrieval",
    rerank: preferences.locale === "tr" ? "Yeniden sıralama" : "Reranking",
    context: preferences.locale === "tr" ? "Bağlamı oluştur" : "Build Context",
    generate: preferences.locale === "tr" ? "Cevap" : "Answer",
    evaluate: preferences.locale === "tr" ? "Değerlendirme" : "Evaluation",
  };
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

  const recentActivity = [
    ...(activeDocument?.parseRuns ?? []).map((run) => ({ createdAt: run.createdAt, detail: run.status === "completed" ? labels.current : run.status, href: "/parse", id: `parse-${run.id}`, label: labels.activityParse, state: runState(run.status) })),
    ...(activeDocument?.chunkRuns ?? []).map((run) => ({ createdAt: run.createdAt, detail: run.strategy === "structure_aware" ? labels.strategyStructure : run.strategy === "recursive_token" ? labels.strategyRecursive : labels.strategyFixed, href: "/chunking", id: `chunk-${run.id}`, label: labels.activityChunk, state: runState(run.status) })),
    ...(activeDocument?.embeddingRuns ?? []).map((run) => ({ createdAt: run.createdAt, detail: run.model ?? labels.currentEmbedding, href: "/embeddings", id: `embedding-${run.id}`, label: labels.activityEmbedding, state: runState(run.status) })),
    ...(activeDocument?.experiments ?? []).map((run) => ({ createdAt: run.createdAt, detail: run.query, href: "/playground", id: `experiment-${run.id}`, label: labels.activityExperiment, state: runState(run.status) })),
    ...(activeDocument?.evaluationRuns ?? []).map((run) => ({ createdAt: run.createdAt, detail: run.status === "completed" ? labels.current : run.status, href: "/evaluation", id: `evaluation-${run.id}`, label: labels.activityEvaluation, state: runState(run.status) })),
  ]
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")))
    .slice(0, 4);

  const setupRows: Array<{ detail: string; label: string; state: PipelineStepState }> = [
    { detail: parseSummary?.status === "completed" ? labels.current : labels.notAvailable, label: labels.latestParse, state: parseState },
    { detail: chunkSummary?.strategy === "structure_aware" ? labels.strategyStructure : chunkSummary?.strategy === "recursive_token" ? labels.strategyRecursive : chunkSummary?.strategy === "fixed_token" ? labels.strategyFixed : labels.notAvailable, label: labels.currentChunking, state: chunkState },
    { detail: embeddingSummary?.model ?? embeddingSummary?.effectiveModel ?? labels.notAvailable, label: labels.currentEmbedding, state: embeddingState },
    { detail: selectedEmbeddingRunId ? labels.current : labels.notAvailable, label: labels.readyForPlayground, state: selectedEmbeddingRunId ? "Ready" : "Locked" },
  ];

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
      <header className="px-4 pb-4 pt-7 sm:px-8 sm:pb-5 sm:pt-8 xl:px-10">
        <div className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-[#969093] sm:block">{copy.nav.overview}</div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-[-0.045em]">{copy.overview.title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-5 text-[#6e676a]">{labels.description}</p>
          </div>
          {activeDocument ? (
            <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#ead6dd] bg-[#fbf4f6] px-3 py-1.5 text-xs font-medium text-[#711f3a]">
              <FileText aria-hidden="true" className="size-3.5" />
              <span className="max-w-[240px] truncate">{activeDocument.fileName}</span>
            </span>
          ) : null}
        </div>
      </header>

      <main className="space-y-5 px-4 pb-10 sm:px-8 xl:px-10">
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
          <article className="rounded-[16px] border border-[#e7e2e4] bg-white p-5 sm:p-6" data-testid="continue-surface">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#711f3a]">{labels.continueEyebrow}</div>
                <h2 className="mt-2 text-lg font-semibold tracking-[-0.025em]">{continuation.title}</h2>
                <p className="mt-2 max-w-xl text-sm leading-5 text-[#6e676a]">{continuation.description}</p>
              </div>
              <span aria-hidden="true" className="hidden size-9 shrink-0 place-items-center rounded-full bg-[#fbf4f6] text-[#711f3a] sm:grid">
                <ArrowRight className="size-4" />
              </span>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[#eee9eb] pt-4">
              {activeDocument ? <span className="max-w-[280px] truncate text-xs font-medium text-[#171416]">{activeDocument.fileName}</span> : <span className="text-xs text-[#969093]">{labels.chooseDocument}</span>}
              <StatusIndicator state={continuation.state} />
              <Button asChild className="ml-auto" size="sm">
                <Link href={continuation.href}>{continuation.action}<ArrowRight aria-hidden="true" /></Link>
              </Button>
            </div>
          </article>

          <article className="rounded-[16px] border border-[#e7e2e4] bg-white p-5 sm:p-6" data-testid="current-setup">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{labels.currentSetup}</h2>
                <p className="mt-1 text-xs leading-5 text-[#6e676a]">{labels.currentSetupDescription}</p>
              </div>
              {activePipeline ? <span className="max-w-[170px] truncate rounded-full bg-[#f7f5f6] px-2.5 py-1 text-[10px] font-medium text-[#6e676a]">{activePipeline.name}</span> : null}
            </div>
            <div className="mt-5 grid gap-3">
              <div className="flex min-w-0 items-center justify-between gap-3 border-b border-[#eee9eb] pb-3">
                <span className="text-xs text-[#6e676a]">{labels.document}</span>
                <span className="max-w-[190px] truncate text-right text-xs font-medium text-[#171416]">{activeDocument?.fileName ?? labels.chooseDocument}</span>
              </div>
              {setupRows.map((row) => (
                <div className="flex min-w-0 items-center justify-between gap-3" key={row.label}>
                  <span className="text-xs text-[#6e676a]">{row.label}</span>
                  <span className="flex min-w-0 items-center gap-2 text-right text-xs font-medium text-[#171416]">
                    <span className="max-w-[145px] truncate">{row.detail}</span>
                    <StatusIndicator compact state={row.state} />
                  </span>
                </div>
              ))}
            </div>
            <details className="mt-5 border-t border-[#eee9eb] pt-3">
              <summary className="cursor-pointer text-xs font-medium text-[#6e676a] marker:text-[#711f3a]">{labels.managePipeline}</summary>
              <div className="mt-4 grid gap-4">
                <div>
                  <label className="text-xs font-medium text-[#171416]" htmlFor="overview-document">{labels.document}</label>
                  <Select disabled={persistenceStatus !== "available" || documents.length === 0} onValueChange={(value) => void selectPersistedDocument(value)} value={activeDocumentId ?? ""}>
                    <SelectTrigger className="mt-2 w-full" id="overview-document"><SelectValue placeholder={labels.chooseDocument} /></SelectTrigger>
                    <SelectContent>{documents.map((document) => <SelectItem key={document.id} value={document.id}>{document.fileName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-[#171416]" htmlFor="overview-pipeline">{labels.pipeline}</label>
                  <Select disabled={!activeDocumentId || pipelines.length === 0} onValueChange={(value) => void selectPipeline(value === "none" ? null : value)} value={activePipelineId ?? "none"}>
                    <SelectTrigger className="mt-2 w-full" id="overview-pipeline"><SelectValue placeholder={labels.noPipeline} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{labels.noPipeline}</SelectItem>
                      {pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button onClick={() => { setEditing("create"); setPipelineName(""); }} size="sm" variant="secondary">{labels.newPipeline}</Button>
                    <Button disabled={!activePipeline} onClick={() => { setEditing("rename"); setPipelineName(activePipeline?.name ?? ""); }} size="sm" variant="ghost">{labels.rename}</Button>
                    <Button disabled={!activePipeline} onClick={() => setConfirmDelete(true)} size="sm" variant="ghost">{labels.remove}</Button>
                  </div>
                  {editing ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Input aria-label={labels.namePlaceholder} className="min-w-[180px] flex-1" maxLength={100} onChange={(event) => setPipelineName(event.target.value)} placeholder={labels.namePlaceholder} value={pipelineName} />
                      <Button disabled={!pipelineName.trim()} onClick={() => void savePipelineName()} size="sm">{labels.save}</Button>
                      <Button onClick={() => setEditing(null)} size="sm" variant="ghost">{labels.cancel}</Button>
                    </div>
                  ) : null}
                  {confirmDelete && activePipeline ? (
                    <div aria-describedby="delete-pipeline-description" aria-labelledby="delete-pipeline-title" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-[#171416]/30 p-4" role="dialog">
                      <div className="w-full max-w-sm rounded-[14px] border border-[#e7e2e4] bg-white p-5 shadow-xl">
                        <h2 className="text-sm font-semibold" id="delete-pipeline-title">{labels.remove}</h2>
                        <p className="mt-2 text-sm leading-5 text-[#6e676a]" id="delete-pipeline-description">{labels.confirmDelete}</p>
                        <div className="mt-5 flex justify-end gap-2">
                          <Button onClick={() => setConfirmDelete(false)} variant="outline">{labels.cancel}</Button>
                          <Button onClick={() => { void deletePipeline(activePipeline.id); setConfirmDelete(false); }} variant="destructive">{labels.remove}</Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </details>
          </article>
        </section>

        <section className="rounded-[18px] border border-[#e7e2e4] bg-white p-4 sm:p-6" data-testid="overview-journey">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">{preferences.locale === "tr" ? "RAG yolculuğu" : "RAG journey"}</h2>
              <p className="mt-1 text-xs leading-5 text-[#6e676a]">{preferences.locale === "tr" ? "Dokümandan değerlendirmeye tek bir bağlı akış." : "One connected flow from document to evaluation."}</p>
            </div>
            <span className="text-xs text-[#969093]">{activePipeline?.name ?? labels.noPipeline}</span>
          </div>

          <div className="relative mt-5 overflow-hidden rounded-[16px] border border-[#eee9eb] bg-[#fbfafb] p-3 sm:p-4 lg:p-5">
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-3 bottom-3 top-11 hidden grid-cols-9 gap-2 lg:grid">
              <div className="col-span-4 rounded-[14px] bg-[#f8f5f6]" />
              <div className="col-span-4 rounded-[14px] bg-[#faf8f8]" />
              <div className="col-span-1 rounded-[14px] bg-[#f8f5f6]" />
            </div>
            <div className="relative hidden grid-cols-9 gap-2 lg:grid">
              <div className="col-span-4 border-l-2 border-[#711f3a] pl-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#711f3a]">{groupLabels.knowledge}</div>
              <div className="col-span-4 border-l-2 border-[#d8b5c2] pl-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#711f3a]">{groupLabels.query}</div>
              <div className="col-span-1 border-l-2 border-[#d8b5c2] pl-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#711f3a]">{groupLabels.quality}</div>
            </div>
            <div className="relative mt-2 min-h-[116px]">
              <div aria-hidden="true" className="pointer-events-none absolute bottom-4 left-6 top-5 w-px bg-[#d8d2d5] lg:hidden" />
              <svg aria-hidden="true" className="pointer-events-none absolute left-4 right-4 top-[42px] hidden h-14 w-[calc(100%-2rem)] lg:block" preserveAspectRatio="none" viewBox="0 0 1000 64">
                <path d="M4 34 C42 5 70 5 108 31 S174 57 214 31 S278 5 324 31 S394 57 438 31 S510 5 552 31 S624 57 666 31 S738 5 780 31 S852 57 896 31 S950 20 996 29" fill="none" pathLength="1" stroke="#d8d2d5" strokeLinecap="round" strokeWidth="2" />
                <path d="M4 34 C42 5 70 5 108 31 S174 57 214 31 S278 5 324 31 S394 57 438 31 S510 5 552 31 S624 57 666 31 S738 5 780 31 S852 57 896 31 S950 20 996 29" fill="none" pathLength="1" stroke="#711f3a" strokeDasharray={`${Math.max(0, (pipelineSteps.filter((step) => pipelineState[step.key] === "Completed").length - 1) / (pipelineSteps.length - 1))} 1`} strokeLinecap="round" strokeWidth="2" />
              </svg>
              <div className="relative grid gap-2 lg:grid-cols-9">
                {pipelineSteps.map((step, index) => <JourneyNode href={stageHref[step.key]} index={index} key={step.key} labels={journeyLabels} reason={lockedReason(step.key)} state={pipelineState[step.key]} step={step} />)}
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
          <article className="rounded-[16px] border border-[#e7e2e4] bg-white p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">{labels.recentActivity}</h2>
                <p className="mt-1 text-xs leading-5 text-[#6e676a]">{activeDocument ? labels.noActivity : labels.noDocumentActivity}</p>
              </div>
              {activeDocument ? <span className="rounded-full bg-[#f7f5f6] px-2.5 py-1 text-[10px] font-medium text-[#6e676a]">{activeDocument.fileName}</span> : null}
            </div>
            {recentActivity.length ? (
              <div className="mt-5 divide-y divide-[#eee9eb]" data-testid="activity-timeline">
                {recentActivity.map((item) => (
                  <Link className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:text-[#501329]" href={item.href} key={item.id}>
                    <span className="size-2 shrink-0 rounded-full bg-[#d8b5c2]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-[#171416]">{item.label}</span>
                      <span className="mt-0.5 block truncate text-xs text-[#6e676a]">{item.detail}</span>
                    </span>
                    <StatusIndicator compact state={item.state} />
                    <span className="hidden text-[10px] text-[#969093] sm:block">{formatActivityDate(item.createdAt, preferences.locale) ?? "—"}</span>
                    <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-[#969093]" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="mt-5 border-t border-[#eee9eb] pt-4 text-xs text-[#969093]">{labels.noActivity}</div>
            )}
          </article>

          <aside className="rounded-[16px] border border-[#ead6dd] bg-[#fbf4f6] p-5 sm:p-6" role="note">
            <BookOpen aria-hidden="true" className="size-5 text-[#711f3a]" />
            <h2 className="mt-4 text-sm font-semibold text-[#501329]">{labels.whyMatters}</h2>
            <p className="mt-2 text-sm leading-6 text-[#61182f]">{labels.whyMattersText}</p>
          </aside>
        </section>

        {persistenceStatus === "checking" ? <EmptyPipelineState>{labels.loading}</EmptyPipelineState>
          : persistenceStatus === "unavailable" ? <><EmptyPipelineState>{labels.unavailable}</EmptyPipelineState><PipelineErrorMessage message={persistenceError?.message} /></>
            : documents.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-[#d8d2d5] bg-white px-5 py-8 text-center"><p className="text-sm text-[#6e676a]">{labels.empty}</p></div>
            ) : null}
      </main>
    </div>
  );
}
