"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import {
  ArrowRight,
  ChevronDown,
} from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { EmptyPipelineState, PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UI_COPY } from "@/lib/copy";
import { blocker, type BlockerCode } from "@/lib/blockers";
import { buildOverviewViewModel, runToStepState } from "@/lib/figma-view-models";
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

const journeyAssets: Record<PipelineStepKey, string> = {
  document: "/assets/figma/overview/documents1.svg",
  parse: "/assets/figma/overview/parsing1.svg",
  chunk: "/assets/figma/overview/chunking1.svg",
  embed: "/assets/figma/overview/embeddings1.svg",
  index: "/assets/figma/overview/embeddings1.svg",
  retrieve: "/assets/figma/overview/playground1.svg",
  rerank: "/assets/figma/overview/evaluation1.svg",
  context: "/assets/figma/overview/source.svg",
  generate: "/assets/figma/overview/sparkle.svg",
  evaluate: "/assets/figma/overview/evaluation1.svg",
};

const journeyPositions: Record<string, { left: number; top: number; label: "above" | "below" }> = {
  document: { left: 62.151, top: 55.979, label: "above" },
  parse: { left: 173.882, top: 115.977, label: "below" },
  chunk: { left: 283.526, top: 55.979, label: "above" },
  embed: { left: 395.256, top: 115.977, label: "below" },
  retrieve: { left: 506.987, top: 55.979, label: "above" },
  rerank: { left: 614.518, top: 115.977, label: "below" },
  context: { left: 726.248, top: 55.979, label: "above" },
  generate: { left: 835.865, top: 115.977, label: "below" },
  evaluate: { left: 947.596, top: 55.979, label: "above" },
};

function JourneyNode({
  href,
  labels,
  reason,
  state,
  step,
}: {
  href: string;
  labels: Record<PipelineStepKey, string>;
  reason: string | null;
  state: PipelineStepState;
  step: PipelineStepDefinition;
}) {
  const position = journeyPositions[step.key];
  const completed = state === "Completed";
  const active = state === "Ready" || state === "Processing" || state === "Error";
  const content = (
    <>
      <span
        className={cn(
          "relative grid size-10 place-items-center rounded-[10px] border bg-white transition-colors",
          completed && "border-transparent bg-[#eef4ef]",
          active && "border-[#e3a9b9] bg-[#f3d9e0]",
          state === "Locked" && "opacity-65",
        )}
      >
        <Image alt="" height={19} src={journeyAssets[step.key]} width={19} />
        {completed ? (
          <span className="absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full bg-[#3f7a55]">
            <Image alt="" height={9} src="/assets/figma/overview/check.svg" width={9} />
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "absolute left-1/2 w-28 -translate-x-1/2 text-center text-[11.5px] font-medium leading-4 text-[#171416]",
          position.label === "above" ? "-top-6" : "top-12",
        )}
      >
        {labels[step.key]}
      </span>
      {reason ? <span className="sr-only">{reason}</span> : null}
    </>
  );

  const className = cn(
    "absolute z-10 outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25 focus-visible:ring-offset-2",
    reason ? "cursor-not-allowed" : "rounded-[10px] hover:ring-2 hover:ring-[#d8b5c2]",
  );
  const style = { left: position.left, top: position.top };
  return reason ? (
    <div aria-disabled="true" className={className} data-testid={`overview-journey-node-${step.key}`} style={style}>
      {content}
    </div>
  ) : (
    <Link className={className} data-testid={`overview-journey-node-${step.key}`} href={href} style={style}>
      {content}
    </Link>
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
        description: "Doküman ayrıştırmadan değerlendirilen cevaplara kadar pipeline'ınızın her aşamasını inceleyin ve geliştirin.",
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
        description: "Inspect and refine every stage of your pipeline — from document parsing to evaluated answers.",
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
  const overviewModel = buildOverviewViewModel({
    activeDocument: activeDocument ? { parseRuns: activeDocument.parseRuns } : undefined,
    activeDocumentId,
    chunk: chunkSummary,
    chunkStatus,
    embedding: embeddingSummary,
    embeddingStatus,
    evaluation: matchingEvaluation,
    experiment: matchingExperiment,
    hasEvaluationDataset: matchingDatasetIds.size > 0,
    parse: parseSummary,
    persistenceStatus,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    selectedParseRunId,
  });
  const pipelineState = overviewModel.pipelineState;
  const parseState = pipelineState.parse;
  const chunkState = pipelineState.chunk;
  const embeddingState = pipelineState.embed;
  const continueHref = overviewModel.continuation.href;
  const continuation: Continuation = (() => {
    switch (overviewModel.continuation.kind) {
      case "checking": return { action: labels.continueAction, description: labels.processingDescription, href: continueHref, state: overviewModel.continuation.state, title: labels.processingTitle };
      case "document": return { action: labels.documentsCta, description: labels.startDescription, href: continueHref, state: overviewModel.continuation.state, title: labels.startTitle };
      case "parse": return { action: labels.continueAction, description: labels.parseDescription, href: continueHref, state: overviewModel.continuation.state, title: labels.parseTitle };
      case "chunk": return { action: labels.continueAction, description: labels.chunkDescription, href: continueHref, state: overviewModel.continuation.state, title: labels.chunkTitle };
      case "embedding": return { action: labels.continueAction, description: labels.embedDescription, href: continueHref, state: overviewModel.continuation.state, title: labels.embedTitle };
      case "playground": return { action: labels.continueAction, description: labels.playgroundDescription, href: continueHref, state: overviewModel.continuation.state, title: labels.playgroundTitle };
      default: return { action: labels.continueAction, description: overviewModel.continuation.kind.endsWith("error") ? labels.reviewDescription : labels.processingDescription, href: continueHref, state: overviewModel.continuation.state, title: overviewModel.continuation.kind.endsWith("error") ? labels.reviewTitle : labels.processingTitle };
    }
  })();

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
    ...(activeDocument?.parseRuns ?? []).map((run) => ({ createdAt: run.createdAt, detail: run.status === "completed" ? labels.current : run.status, href: "/parse", id: `parse-${run.id}`, label: labels.activityParse, state: runToStepState(run.status) })),
    ...(activeDocument?.chunkRuns ?? []).map((run) => ({ createdAt: run.createdAt, detail: run.strategy === "structure_aware" ? labels.strategyStructure : run.strategy === "recursive_token" ? labels.strategyRecursive : labels.strategyFixed, href: "/chunking", id: `chunk-${run.id}`, label: labels.activityChunk, state: runToStepState(run.status) })),
    ...(activeDocument?.embeddingRuns ?? []).map((run) => ({ createdAt: run.createdAt, detail: run.model ?? labels.currentEmbedding, href: "/embeddings", id: `embedding-${run.id}`, label: labels.activityEmbedding, state: runToStepState(run.status) })),
    ...(activeDocument?.experiments ?? []).map((run) => ({ createdAt: run.createdAt, detail: run.query, href: "/playground", id: `experiment-${run.id}`, label: labels.activityExperiment, state: runToStepState(run.status) })),
    ...(activeDocument?.evaluationRuns ?? []).map((run) => ({ createdAt: run.createdAt, detail: run.status === "completed" ? labels.current : run.status, href: "/evaluation", id: `evaluation-${run.id}`, label: labels.activityEvaluation, state: runToStepState(run.status) })),
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

  const nextStepLabel = continuation.href === "/documents"
    ? copy.nav.documents
    : continuation.href === "/parse"
      ? copy.nav.parse
      : continuation.href === "/chunking"
        ? copy.nav.chunking
        : continuation.href === "/embeddings"
          ? copy.nav.embeddings
          : copy.nav.playground;
  const continueLabel = continuation.href === "/documents"
    ? labels.documentsCta
    : `${labels.continueAction} to ${nextStepLabel}`;
  const canonicalSetupRows = setupRows.slice(0, 3);

  return (
    <div className="min-w-0 overflow-x-clip bg-[#f8f7f7]" data-testid="figma-overview-root">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4" data-testid="figma-overview-main">
        <header className="h-[82px] w-full" data-testid="figma-overview-header">
          <h1 className="m-0 text-[28px] font-semibold leading-[34px] tracking-[-0.56px] text-[#171416]">{copy.overview.title}</h1>
          <p className="mt-[6px] w-full max-w-[560px] text-sm leading-[21px] text-[#6e676a]">{labels.description}</p>
        </header>

        <section className="mt-7 flex h-[77.424px] w-full items-center justify-between rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white px-5 py-4 max-lg:h-auto max-lg:gap-4 max-lg:py-4" data-testid="continue-surface">
          <div className="flex min-w-0 items-center gap-9 max-lg:flex-wrap">
            <p className="m-0 shrink-0 text-[13px] font-semibold uppercase leading-[19.5px] tracking-[0.78px] text-[#969093]">{labels.continueEyebrow}</p>
            <div className="flex min-w-0 gap-9 max-sm:flex-wrap">
              <div className="w-[152px] min-w-0">
                <p className="m-0 text-xs leading-[18px] text-[#969093]">{preferences.locale === "tr" ? "Mevcut doküman" : "Current document"}</p>
                <p className="mt-0.5 truncate text-[13.5px] font-medium leading-[20.25px] text-[#171416]">{activeDocument?.fileName ?? labels.chooseDocument}</p>
              </div>
              <div className="w-[102px] min-w-0">
                <p className="m-0 text-xs leading-[18px] text-[#969093]">{preferences.locale === "tr" ? "Sonraki adım" : "Next step"}</p>
                <p className="mt-0.5 truncate text-[13.5px] font-medium leading-[20.25px] text-[#171416]">
                  {nextStepLabel} <span className="ml-1 text-[11.5px] font-medium leading-[17.25px] text-[#61182f]">{copy.status[continuation.state]}</span>
                </p>
              </div>
            </div>
          </div>
          <Button asChild className="h-[42px] gap-2 rounded-[10px] px-4 text-sm shadow-[0_1px_1px_rgba(0,0,0,0.12)] max-sm:hidden" disabled={Boolean(lockedReason("document"))}>
            <Link href={continuation.href}>{continueLabel}<ArrowRight aria-hidden="true" className="size-4" /></Link>
          </Button>
        </section>

        <section className="mt-9 h-[277.424px] w-full rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white px-7 pb-4 pt-5 max-lg:h-auto max-lg:overflow-x-auto" data-testid="figma-overview-pipeline">
          <div className="flex h-[22px] w-full items-center justify-between">
            <h2 className="m-0 text-base font-semibold leading-[22px] text-[#171416]">{preferences.locale === "tr" ? "Pipeline" : "Pipeline"}</h2>
            <p className="m-0 text-[12.5px] leading-[18.75px] text-[#969093] max-sm:hidden">{preferences.locale === "tr" ? "Dokümandan değerlendirilen cevaba akışı takip edin" : "Follow the flow from document to evaluated answer"}</p>
          </div>
          <div className="relative h-[216px] w-full min-w-[780px] overflow-hidden pt-3" data-testid="overview-journey">
            <div className="relative h-[200px] w-full min-w-[780px]">
              <div className="absolute left-[25.034px] top-1 h-[192px] w-[441px] rounded-[14px] border-[1.712px] border-[rgba(231,226,228,0.6)] bg-[#fbfafb]" data-testid="figma-overview-prepare"><span className="absolute left-3.5 top-3 font-mono text-[10px] font-medium uppercase leading-[15px] tracking-[0.8px] text-[#969093]">{groupLabels.knowledge}</span></div>
              <div className="absolute left-[476.356px] top-1 h-[192px] w-[428px] rounded-[14px] border-[1.712px] border-[rgba(231,226,228,0.6)] bg-[#fbfafb]" data-testid="figma-overview-test"><span className="absolute left-3.5 top-3 font-mono text-[10px] font-medium uppercase leading-[15px] tracking-[0.8px] text-[#969093]">{groupLabels.query}</span></div>
              <div className="absolute left-[914.809px] top-1 h-[192px] w-[114px] rounded-[14px] border-[1.712px] border-[rgba(231,226,228,0.6)] bg-[rgba(251,244,246,0.6)]" data-testid="figma-overview-measure"><span className="absolute left-3.5 top-3 font-mono text-[10px] font-medium uppercase leading-[15px] tracking-[0.8px] text-[#969093]">{groupLabels.quality}</span></div>
              <Image alt="" className="pointer-events-none absolute left-[-0.05px] top-px h-[199.975px] w-[1054.1px] max-w-none" height={200} priority src="/assets/figma/overview/icon.svg" width={1054} />
              {pipelineSteps.map((step) => <JourneyNode href={stageHref[step.key]} key={step.key} labels={journeyLabels} reason={lockedReason(step.key)} state={pipelineState[step.key]} step={step} />)}
            </div>
          </div>
        </section>

        <section className="mt-9 grid h-[277.761px] w-full grid-cols-[minmax(0,615.788px)_minmax(0,473.671px)] gap-6 max-lg:h-auto max-lg:grid-cols-1" data-testid="figma-overview-lower">
          <article className="h-[277.761px] rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white p-5" data-testid="current-setup">
            <p className="m-0 text-[13px] font-semibold uppercase leading-[19.5px] tracking-[0.78px] text-[#969093]">{labels.currentSetup}</p>
            <div className="mt-3">
              <div className="flex h-[42.712px] items-center justify-between gap-4 border-b-[1.712px] border-[#e7e2e4] text-[13px] leading-[19.5px] text-[#6e676a]"><span>{labels.document}</span><strong className="max-w-[380px] truncate text-right text-[13.5px] font-medium leading-[20.25px] text-[#171416]">{activeDocument?.fileName ?? labels.chooseDocument}</strong></div>
              {canonicalSetupRows.map((row, index) => <div className={cn("flex items-center justify-between gap-4 text-[13px] leading-[19.5px] text-[#6e676a]", index === canonicalSetupRows.length - 1 ? "h-[41px]" : "h-[42.712px] border-b-[1.712px] border-[#e7e2e4]")} key={row.label}><span>{row.label}</span><strong className="max-w-[380px] truncate text-right text-[13.5px] font-medium leading-[20.25px] text-[#171416]">{row.detail}</strong></div>)}
            </div>
          </article>

          <article className="h-[277.761px] rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white p-5" data-testid="figma-overview-recent-activity">
            <p className="m-0 text-[13px] font-semibold uppercase leading-[19.5px] tracking-[0.78px] text-[#969093]">{labels.recentActivity}</p>
            <div className="mt-3">
              {recentActivity.length ? recentActivity.map((item, index) => <Link className={cn("flex h-[55px] items-start gap-3 pt-3", index === 0 && "h-[41px] pt-0")} href={item.href} key={item.id}>
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#eef4ef]"><Image alt="" height={12} src="/assets/figma/overview/check1.svg" width={12} /></span>
                <span className="min-w-0"><span className="block truncate text-[13.5px] font-medium leading-[20.25px] text-[#171416]">{item.label}{item.state === "Completed" ? ` ${preferences.locale === "tr" ? "tamamlandı" : "completed"}` : ""}</span><span className="flex items-center gap-1 text-xs leading-[18px] text-[#969093]"><Image alt="" height={12} src="/assets/figma/overview/clock.svg" width={12} />{formatActivityDate(item.createdAt, preferences.locale) ?? item.detail}</span></span>
              </Link>) : <p className="border-t border-[#e7e2e4] pt-4 text-xs leading-5 text-[#969093]">{activeDocument ? labels.noActivity : labels.noDocumentActivity}</p>}
            </div>
          </article>
        </section>

        <aside className="mt-6 flex h-[97px] w-full items-start gap-3 rounded-[14px] border-[1.712px] border-[#f3d9e0] bg-[#fbf4f6] p-4" data-testid="figma-overview-learning-note" role="note">
          <Image alt="" className="mt-0.5 shrink-0" height={17} src="/assets/figma/overview/info.svg" width={17} />
          <div>
            <h2 className="m-0 text-[13px] font-semibold leading-[19.5px] text-[#501329]">{labels.whyMatters}</h2>
            <p className="mt-1 w-full max-w-[560px] text-[13px] leading-[19px] text-[rgba(59,13,29,0.75)]">{preferences.locale === "tr" ? "Her aşama aşağı akışta ne olacağını değiştirir. Akışı anlamak, RAG'ı bir kara kutu olarak görmek yerine retrieval, bağlam seçimi ve cevap kalitesini teşhis etmenizi sağlar." : "Each stage changes what happens downstream. Understanding the flow helps you diagnose retrieval quality, context selection, and answer quality instead of treating RAG as a black box."}</p>
          </div>
        </aside>

        <details className="mt-6 rounded-[12px] border border-[#e7e2e4] bg-white">
          <summary className="flex h-[46px] cursor-pointer list-none items-center justify-between px-4 text-[13px] font-medium text-[#171416]"><span>{labels.managePipeline}</span><ChevronDown aria-hidden="true" className="size-4 text-[#969093]" /></summary>
          <div className="grid gap-4 border-t border-[#e7e2e4] p-4 lg:grid-cols-2">
            <label className="text-xs font-medium text-[#171416]" htmlFor="overview-document">{labels.document}</label>
            <Select disabled={persistenceStatus !== "available" || documents.length === 0} onValueChange={(value) => void selectPersistedDocument(value)} value={activeDocumentId ?? ""}>
              <SelectTrigger className="lg:col-start-1" id="overview-document"><SelectValue placeholder={labels.chooseDocument} /></SelectTrigger>
              <SelectContent>{documents.map((document) => <SelectItem key={document.id} value={document.id}>{document.fileName}</SelectItem>)}</SelectContent>
            </Select>
            <label className="text-xs font-medium text-[#171416] lg:col-start-2 lg:row-start-1" htmlFor="overview-pipeline">{labels.pipeline}</label>
            <Select disabled={!activeDocumentId || pipelines.length === 0} onValueChange={(value) => void selectPipeline(value === "none" ? null : value)} value={activePipelineId ?? "none"}>
              <SelectTrigger className="lg:col-start-2" id="overview-pipeline"><SelectValue placeholder={labels.noPipeline} /></SelectTrigger>
              <SelectContent><SelectItem value="none">{labels.noPipeline}</SelectItem>{pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2 lg:col-span-2"><Button onClick={() => { setEditing("create"); setPipelineName(""); }} size="sm" variant="secondary">{labels.newPipeline}</Button><Button disabled={!activePipeline} onClick={() => { setEditing("rename"); setPipelineName(activePipeline?.name ?? ""); }} size="sm" variant="ghost">{labels.rename}</Button><Button disabled={!activePipeline} onClick={() => setConfirmDelete(true)} size="sm" variant="ghost">{labels.remove}</Button></div>
            {editing ? <div className="flex gap-2 lg:col-span-2"><Input aria-label={labels.namePlaceholder} maxLength={100} onChange={(event) => setPipelineName(event.target.value)} placeholder={labels.namePlaceholder} value={pipelineName} /><Button disabled={!pipelineName.trim()} onClick={() => void savePipelineName()} size="sm">{labels.save}</Button><Button onClick={() => setEditing(null)} size="sm" variant="ghost">{labels.cancel}</Button></div> : null}
            {confirmDelete && activePipeline ? <div aria-describedby="delete-pipeline-description" aria-labelledby="delete-pipeline-title" aria-modal="true" className="rounded-[10px] border border-[#eadfc9] bg-[#fffaf1] p-4 lg:col-span-2" role="dialog"><h2 className="text-sm font-semibold" id="delete-pipeline-title">{labels.remove}</h2><p className="mt-1 text-sm text-[#6e676a]" id="delete-pipeline-description">{labels.confirmDelete}</p><div className="mt-3 flex gap-2"><Button onClick={() => setConfirmDelete(false)} variant="outline">{labels.cancel}</Button><Button onClick={() => { void deletePipeline(activePipeline.id); setConfirmDelete(false); }} variant="destructive">{labels.remove}</Button></div></div> : null}
          </div>
        </details>

        {persistenceStatus === "checking" ? <EmptyPipelineState>{labels.loading}</EmptyPipelineState> : persistenceStatus === "unavailable" ? <><EmptyPipelineState>{labels.unavailable}</EmptyPipelineState><PipelineErrorMessage message={persistenceError?.message} /></> : documents.length === 0 ? <p className="sr-only">{labels.empty}</p> : null}
      </div>
    </div>
  );
}
