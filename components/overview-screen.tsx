"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { SampleDocumentButton } from "@/components/sample-document-button";
import { LearningHint, PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { StatusIndicator } from "@/components/status-indicator";
import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UI_COPY, type AppLocale } from "@/lib/copy";
import { blocker, type BlockerCode } from "@/lib/blockers";
import { buildOverviewViewModel } from "@/lib/figma-view-models";
import type { OverviewContinuationKind } from "@/lib/figma-view-models";
import {
  buildJourneyConnectorPath,
  deriveJourneyConnectorState,
  JOURNEY_CANVAS,
  JOURNEY_CONNECTOR_PAIRS,
  journeyConnectorVisualForState,
  journeyGroupPosition,
  journeyNodePosition,
  journeyNodeVisualForState,
  type JourneyStepKey,
} from "@/lib/overview-journey";
import type { PipelineStepDefinition, PipelineStepKey, PipelineStepState } from "@/lib/rag-ui-types";
import { cn } from "@/lib/utils";

const pipelineSteps = [
  { key: "document", icon: "document" },
  { key: "parse", icon: "parse" },
  { key: "chunk", icon: "chunk" },
  { key: "embed", icon: "embed" },
  { key: "retrieve", icon: "retrieve" },
  { key: "rerank", icon: "rerank" },
  { key: "context", icon: "context" },
  { key: "generate", icon: "generate" },
  { key: "evaluate", icon: "evaluate" },
] as const satisfies readonly PipelineStepDefinition[];

type JourneyPipelineStep = (typeof pipelineSteps)[number];

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

const journeyIcons: Record<JourneyStepKey, SemanticIconName> = {
  document: "document",
  parse: "parse",
  chunk: "chunk",
  embed: "embed",
  retrieve: "retrieve",
  rerank: "rerank",
  context: "context",
  generate: "generate",
  evaluate: "evaluate",
};

const continuationCopy: Record<AppLocale, Record<OverviewContinuationKind, { action: string; nextStep: string }>> = {
  tr: {
    checking: { action: "Workspace'i aç", nextStep: "Workspace" },
    document: { action: "Doküman seç", nextStep: "Doküman" },
    "parse-processing": { action: "Parsing'i izle", nextStep: "Parsing" },
    "parse-error": { action: "Parsing sorununu incele", nextStep: "Parsing" },
    parse: { action: "Parsing'e devam et", nextStep: "Parsing" },
    "chunk-processing": { action: "Chunking'i izle", nextStep: "Chunking" },
    "chunk-error": { action: "Chunking sorununu incele", nextStep: "Chunking" },
    chunk: { action: "Chunking'e devam et", nextStep: "Chunking" },
    "embedding-processing": { action: "Embedding'i izle", nextStep: "Embeddings" },
    "embedding-error": { action: "Embedding sorununu incele", nextStep: "Embeddings" },
    embedding: { action: "Embedding'e devam et", nextStep: "Embeddings" },
    playground: { action: "Playground'a devam et", nextStep: "Playground" },
  },
  en: {
    checking: { action: "Open workspace", nextStep: "Workspace" },
    document: { action: "Select a document", nextStep: "Document" },
    "parse-processing": { action: "Monitor parsing", nextStep: "Parsing" },
    "parse-error": { action: "Review parsing issue", nextStep: "Parsing" },
    parse: { action: "Continue to Parsing", nextStep: "Parsing" },
    "chunk-processing": { action: "Monitor chunking", nextStep: "Chunking" },
    "chunk-error": { action: "Review chunking issue", nextStep: "Chunking" },
    chunk: { action: "Continue to Chunking", nextStep: "Chunking" },
    "embedding-processing": { action: "Monitor embeddings", nextStep: "Embeddings" },
    "embedding-error": { action: "Review embedding issue", nextStep: "Embeddings" },
    embedding: { action: "Continue to Embeddings", nextStep: "Embeddings" },
    playground: { action: "Continue to Playground", nextStep: "Playground" },
  },
};

const selectorTriggerClass = "h-10 min-w-0 max-w-full overflow-hidden [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:flex-1 [&_[data-slot=select-value]]:truncate [&_[data-slot=select-value]]:whitespace-nowrap";
const selectorItemClass = "h-auto min-h-8 whitespace-normal break-words";

function JourneyGlyph({ stepKey, state }: { stepKey: JourneyStepKey; state: PipelineStepState }) {
  const visual = journeyNodeVisualForState(state);
  return (
    <AppIcon
      aria-hidden="true"
      className="size-[19px]"
      data-state={state}
      data-testid={`overview-journey-glyph-${stepKey}`}
      name={journeyIcons[stepKey]}
      style={{ color: visual.iconColor }}
    />
  );
}

function JourneyConnectors({ stateFor }: { stateFor: (step: JourneyStepKey) => PipelineStepState }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute left-0 top-px z-[1] h-[199.975px] w-full overflow-visible"
      data-testid="overview-journey-connectors"
      height={JOURNEY_CANVAS.height}
      preserveAspectRatio="none"
      viewBox={`0 0 ${JOURNEY_CANVAS.width} ${JOURNEY_CANVAS.height}`}
      width="100%"
    >
      {JOURNEY_CONNECTOR_PAIRS.map(({ destination, source }) => {
        const state = deriveJourneyConnectorState(stateFor(source), stateFor(destination));
        const visual = journeyConnectorVisualForState(state);
        return (
          <path
            d={buildJourneyConnectorPath(source, destination)}
            data-state={state}
            data-testid={`overview-journey-connector-${source}-${destination}`}
            fill="none"
            key={`${source}-${destination}`}
            stroke={visual.color}
            strokeLinecap="round"
            strokeOpacity={visual.opacity}
            strokeWidth={visual.width}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

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
  step: JourneyPipelineStep;
}) {
  const position = journeyNodePosition(step.key);
  const visual = journeyNodeVisualForState(state);
  const completed = state === "Completed";
  const content = (
    <>
      <span
        className="relative grid size-10 place-items-center rounded-[10px] border transition-colors"
        data-state={state}
        style={{
          backgroundColor: visual.backgroundColor,
          borderColor: visual.borderColor,
          color: visual.iconColor,
          opacity: visual.opacity,
        }}
      >
        <JourneyGlyph state={state} stepKey={step.key} />
        {completed ? (
          <span className="absolute -right-1 -top-1 grid size-3.5 place-items-center rounded-full bg-success">
            <AppIcon name="check" className="size-[9px] text-primary-foreground" />
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "absolute left-1/2 w-28 -translate-x-1/2 text-center text-[11.5px] font-medium leading-4 text-foreground",
          position.label === "above" ? "-top-6" : "top-12",
        )}
      >
        {labels[step.key]}
      </span>
      {reason ? <span className="sr-only">{reason}</span> : null}
    </>
  );

  const className = cn(
    "absolute z-10 outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-2",
    reason ? "cursor-not-allowed" : "rounded-[10px] hover:ring-2 hover:ring-accent-border",
  );
  const style = { left: position.left, top: position.top };
  return reason ? (
    <div aria-disabled="true" className={className} data-state={state} data-testid={`overview-journey-node-${step.key}`} style={style}>
      {content}
    </div>
  ) : (
    <Link className={className} data-state={state} data-testid={`overview-journey-node-${step.key}`} href={href} style={style}>
      {content}
    </Link>
  );
}

function JourneyCompact({ labels, reasonFor, stateFor }: { labels: Record<PipelineStepKey, string>; reasonFor: (step: PipelineStepKey) => string | null; stateFor: (step: PipelineStepKey) => PipelineStepState }) {
  return (
    <ol className="grid gap-2" data-testid="overview-journey-compact">
      {pipelineSteps.map((step) => {
        const reason = reasonFor(step.key);
        const state = stateFor(step.key);
        const content = (
          <>
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-border bg-card">
              <JourneyGlyph state={state} stepKey={step.key} />
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground">{labels[step.key]}</span>
            <StatusIndicator state={state} />
          </>
        );
        return (
          <li key={step.key}>
            {reason ? <div aria-disabled="true" className="flex min-w-0 items-center gap-3 rounded-[10px] border border-border bg-card px-3 py-2.5 opacity-75" data-testid={`overview-compact-journey-node-${step.key}`} title={reason}>{content}</div> : <Link className="flex min-w-0 items-center gap-3 rounded-[10px] border border-border bg-card px-3 py-2.5 outline-none hover:border-accent-border focus-visible:ring-2 focus-visible:ring-ring/25" data-testid={`overview-compact-journey-node-${step.key}`} href={stageHref[step.key]}>{content}</Link>}
          </li>
        );
      })}
    </ol>
  );
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
  const [managementBusy, setManagementBusy] = useState(false);
  const [managementError, setManagementError] = useState<string | null>(null);
  const managementMenuRef = useRef<HTMLDetailsElement>(null);

  const labels = preferences.locale === "tr"
    ? {
        description: "Seçili doküman ve indexing pipeline'ını yönetin; build aşamalarına buradan geçin.",
        workspace: "Workspace",
        workspaceHint: "Doküman ve pipeline seçimi bu çalışma alanının kaynağıdır.",
        document: "Doküman",
        pipeline: "Indexing pipeline",
        chooseDocument: "Doküman seçin",
        noPipeline: "Pipeline seçin",
        newPipeline: "Yeni pipeline",
        rename: "Yeniden adlandır",
        remove: "Sil",
        save: "Kaydet",
        cancel: "Vazgeç",
        namePlaceholder: "Pipeline adı",
        confirmDelete: "Bu pipeline silinsin mi? Artifact’lar silinmez.",
        noActivePipeline: "Bu doküman için pipeline seçilmedi.",
        selectDocumentForPipeline: "Pipeline yönetmek için önce bir doküman seçin.",
        continueTitle: "Devam et",
        nextStep: "Sıradaki aşama",
        clearPipeline: "Pipeline seçimini kaldır",
        managePipeline: "Pipeline'ı yönet",
        journey: "Pipeline journey",
        journeyDescription: "Seçili workspace'in build ve deney aşamalarına geçin.",
        whyMatters: "Bu neden önemli?",
        whyMattersText: "Parse, chunk ve embedding seçimleri aşağı akıştaki retrieval sonucunu değiştirir. Her aşamayı seçili lineage üzerinden inceleyin.",
        empty: "Henüz doküman yok. Başlamak için Documents ekranından bir PDF ekleyin.",
        loading: "Doküman workspace’i yükleniyor…",
        unavailable: "Doküman servisi kullanılamıyor.",
      }
    : {
        description: "Manage the selected document and indexing pipeline, then move into each build stage.",
        workspace: "Workspace",
        workspaceHint: "The document and pipeline define the workspace you are building.",
        document: "Document",
        pipeline: "Indexing pipeline",
        chooseDocument: "Select a document",
        noPipeline: "Select a pipeline",
        newPipeline: "New pipeline",
        rename: "Rename",
        remove: "Delete",
        save: "Save",
        cancel: "Cancel",
        namePlaceholder: "Pipeline name",
        confirmDelete: "Delete this pipeline? Artifacts will not be deleted.",
        noActivePipeline: "No pipeline is selected for this document.",
        selectDocumentForPipeline: "Select a document before managing pipelines.",
        continueTitle: "Continue where you left off",
        nextStep: "Next step",
        clearPipeline: "Clear pipeline selection",
        managePipeline: "Manage pipeline",
        journey: "Pipeline journey",
        journeyDescription: "Open the build and experiment stages for this workspace.",
        whyMatters: "Why this matters",
        whyMattersText: "Parse, chunk, and embedding choices change downstream retrieval. Inspect each stage through the selected lineage.",
        empty: "No documents yet. Add a PDF from Documents to begin.",
        loading: "Loading document workspace…",
        unavailable: "The document service is unavailable.",
      };

  const parseSummary = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId);
  const chunkSummary = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId);
  const embeddingSummary = activeDocument?.embeddingRuns.find((run) => run.id === selectedEmbeddingRunId);
  const matchingExperiment = activeDocument?.experiments.find(
    (run) => run.isCompatible && run.chunkRunId === selectedChunkRunId && (run.embeddingRunId === null || run.embeddingRunId === selectedEmbeddingRunId),
  );
  const matchingDatasetIds = new Set(
    activeDocument?.evaluationDatasets.filter((dataset) => dataset.parseRunId === selectedParseRunId).map((dataset) => dataset.id) ?? [],
  );
  const matchingEvaluation = activeDocument?.evaluationRuns.find(
    (run) => matchingDatasetIds.has(run.datasetId) && run.chunkRunId === selectedChunkRunId && run.embeddingRunId === selectedEmbeddingRunId,
  );
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
  const isFirstUse = persistenceStatus === "available" && documents.length === 0;
  const continuationText = continuationCopy[preferences.locale][overviewModel.continuation.kind];

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
    if (!activeDocumentId) code = "missing_document";
    else if (step === "chunk" && !selectedParseRunId) code = "missing_parse";
    else if ((step === "embed" || step === "index" || step === "retrieve") && !selectedChunkRunId) code = "missing_chunk";
    else if (step === "evaluate" && matchingDatasetIds.size === 0) code = "missing_dataset";
    return blocker(preferences.locale, code).message;
  }

  async function savePipelineName() {
    const name = pipelineName.trim();
    if (!name || !activeDocumentId || managementBusy) return;
    setManagementBusy(true);
    setManagementError(null);
    try {
      const result = editing === "create" ? await createPipeline(name) : editing === "rename" && activePipeline ? await renamePipeline(activePipeline.id, name) : null;
      if (!result) {
        setManagementError(preferences.locale === "tr" ? "Pipeline kaydedilemedi. Tekrar deneyin." : "The pipeline could not be saved. Try again.");
        return;
      }
      setEditing(null);
      setPipelineName("");
    } finally {
      setManagementBusy(false);
    }
  }

  async function confirmPipelineDelete() {
    if (!activePipeline || managementBusy) return;
    setManagementBusy(true);
    setManagementError(null);
    try {
      if (await deletePipeline(activePipeline.id)) setConfirmDelete(false);
      else setManagementError(preferences.locale === "tr" ? "Pipeline silinemedi. Tekrar deneyin." : "The pipeline could not be deleted. Try again.");
    } finally {
      setManagementBusy(false);
    }
  }

  function beginCreatePipeline() {
    setConfirmDelete(false);
    setManagementError(null);
    setEditing("create");
    setPipelineName("");
    if (managementMenuRef.current) managementMenuRef.current.open = false;
  }

  function beginRenamePipeline() {
    if (!activePipeline) return;
    setConfirmDelete(false);
    setManagementError(null);
    setEditing("rename");
    setPipelineName(activePipeline.name);
    if (managementMenuRef.current) managementMenuRef.current.open = false;
  }

  return (
    <div className="min-w-0 overflow-x-clip bg-background" data-testid="figma-overview-root">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4" data-testid="figma-overview-main">
        <header className="min-h-[82px] w-full" data-testid="figma-overview-header">
          <h1 className="m-0 text-[28px] font-semibold leading-[34px] tracking-[-0.56px] text-foreground">{copy.overview.title}</h1>
          <p className="mt-[6px] w-full max-w-[640px] text-sm leading-[21px] text-muted-foreground">{isFirstUse ? (preferences.locale === "tr" ? "Bir PDF'nin RAG pipeline boyunca nasıl işlendiğini ve cevabın hangi kaynaklara dayandığını görün." : "See how a PDF moves through a RAG pipeline and which sources support the final answer.") : labels.description}</p>
        </header>

        {isFirstUse ? <section className="mt-5 rounded-[16px] border-[1.712px] border-border bg-card p-5 sm:p-6" data-testid="overview-first-use">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-brand">{preferences.locale === "tr" ? "İlk adım" : "Start here"}</p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-foreground">{preferences.locale === "tr" ? "Bir dokümanla başlayın" : "Begin with a document"}</h2>
          <p className="mt-2 max-w-[700px] text-sm leading-6 text-muted-foreground">{preferences.locale === "tr" ? "Kendi PDF'nizi ekleyin veya dört sayfalık kurgusal örnekle akışı deneyin. Önce parsing, ardından chunking ve retrieval sonuçlarını inceleyebilirsiniz." : "Add your own PDF or try the four-page fictional sample. Inspect parsing, then chunks and retrieval results as you go."}</p>
          <ol className="mt-5 grid gap-3 sm:grid-cols-3">
            {(
              preferences.locale === "tr"
                ? ["PDF ekle", "Aşamaları incele", "Kaynaklı cevap al"]
                : ["Add a PDF", "Inspect each stage", "Get a sourced answer"]
            ).map((step, index) => <li className="flex items-center gap-3 rounded-[10px] border border-border bg-surface-subtle px-3 py-3 text-sm font-medium text-foreground" key={step}><span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-brand">{index + 1}</span>{step}</li>)}
          </ol>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <SampleDocumentButton primary />
            <Button asChild variant="outline"><Link href="/documents">{preferences.locale === "tr" ? "Kendi PDF'ni ekle" : "Add your own PDF"}<AppIcon className="size-4" name="arrowRight" /></Link></Button>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">{preferences.locale === "tr" ? "Örnek kurgusaldır. Kendi dosyalarınız hesabınıza kaydedilir; kişisel veya gizli içerik yüklemeyin." : "The sample is fictional. Your own files are saved to your account; avoid uploading personal or confidential content."}</p>
        </section> : <>
        <section className="mt-5 rounded-[16px] border-[1.712px] border-border bg-card p-4" data-testid="workspace-control-plane">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] font-semibold uppercase leading-[19.5px] tracking-[0.78px] text-subtle-foreground">{labels.workspace}</p>
            <p className="text-xs leading-[18px] text-muted-foreground">{labels.workspaceHint}</p>
          </div>
          <div className="mt-2.5 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <label className="mb-1.5 block text-xs font-medium text-foreground" htmlFor="overview-document">{labels.document}</label>
                  <Select disabled={persistenceStatus !== "available" || documents.length === 0} onValueChange={(value) => void selectPersistedDocument(value)} value={activeDocumentId ?? ""}>
                    <SelectTrigger aria-label={labels.document} className={selectorTriggerClass} data-testid="overview-document-selector" id="overview-document" title={activeDocument?.fileName ?? labels.chooseDocument}><SelectValue placeholder={labels.chooseDocument} /></SelectTrigger>
                    <SelectContent>{documents.map((document) => <SelectItem className={selectorItemClass} key={document.id} value={document.id}>{document.fileName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="min-w-0">
                  <label className="mb-1.5 block text-xs font-medium text-foreground" htmlFor="overview-pipeline">{labels.pipeline}</label>
                  <Select disabled={!activeDocumentId || pipelines.length === 0} onValueChange={(value) => void selectPipeline(value)} value={activePipelineId ?? ""}>
                    <SelectTrigger aria-label={labels.pipeline} className={selectorTriggerClass} data-testid="overview-pipeline-selector" id="overview-pipeline" title={activePipeline?.name ?? labels.noPipeline}><SelectValue placeholder={labels.noPipeline} /></SelectTrigger>
                    <SelectContent>{pipelines.map((pipeline) => <SelectItem className={selectorItemClass} key={pipeline.id} value={pipeline.id}>{pipeline.name}{pipeline.isDefault ? " · default" : ""}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
            <details className="relative self-end" data-testid="pipeline-management" ref={managementMenuRef}>
              <summary className="flex h-[42px] cursor-pointer list-none items-center justify-between gap-3 rounded-[10px] border border-input bg-card px-3 text-xs font-medium text-muted-foreground outline-none hover:border-hover-border hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/25">
                <span>{labels.managePipeline}</span>
                <AppIcon name="chevronDown" className="size-3.5 text-subtle-foreground" />
              </summary>
              <div className="absolute right-0 z-20 mt-2 flex w-[min(28rem,calc(100vw-4rem))] flex-wrap gap-2 rounded-[10px] border border-border bg-card p-3 shadow-lg">
                <Button disabled={!activeDocumentId || persistenceStatus !== "available" || managementBusy} onClick={beginCreatePipeline} size="sm" variant="secondary">{labels.newPipeline}</Button>
                {activePipeline ? <Button onClick={() => void selectPipeline(null)} size="sm" variant="ghost" data-testid="clear-pipeline-selection">{labels.clearPipeline}</Button> : null}
                <Button disabled={!activePipeline || managementBusy} onClick={beginRenamePipeline} size="sm" variant="outline">{labels.rename}</Button>
                <Button disabled={!activePipeline || managementBusy} onClick={() => { setEditing(null); setManagementError(null); setConfirmDelete(true); if (managementMenuRef.current) managementMenuRef.current.open = false; }} size="sm" variant="ghost">{labels.remove}</Button>
              </div>
            </details>
          </div>

          <div className="mt-3.5 grid min-w-0 gap-3 border-t border-border pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="continue-surface">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-semibold uppercase leading-[16.5px] tracking-[0.66px] text-subtle-foreground">{labels.continueTitle}</p>
                <StatusIndicator state={overviewModel.continuation.state} />
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{labels.nextStep}: <span className="font-medium text-foreground">{continuationText.nextStep}</span></p>
            </div>
            <Button asChild className="h-[42px] min-w-0 gap-2 rounded-[10px] px-4 text-sm" data-testid="overview-continue-action">
              <Link href={overviewModel.continuation.href}>{continuationText.action}<AppIcon name="arrowRight" className="size-4" /></Link>
            </Button>
          </div>

          {editing ? (
            <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4" data-testid="pipeline-name-editor">
              <label className="sr-only" htmlFor="overview-pipeline-name">{labels.namePlaceholder}</label>
              <Input autoFocus className="max-w-sm" id="overview-pipeline-name" maxLength={100} onChange={(event) => setPipelineName(event.target.value)} placeholder={labels.namePlaceholder} value={pipelineName} />
              <Button disabled={!pipelineName.trim() || managementBusy} onClick={() => void savePipelineName()} size="sm">{managementBusy ? (preferences.locale === "tr" ? "Kaydediliyor…" : "Saving…") : labels.save}</Button>
              <Button disabled={managementBusy} onClick={() => { setEditing(null); setManagementError(null); }} size="sm" variant="ghost">{labels.cancel}</Button>
            </div>
          ) : null}

          <DialogPrimitive.Root onOpenChange={(open) => { if (!open && !managementBusy) { setConfirmDelete(false); setManagementError(null); } }} open={confirmDelete && Boolean(activePipeline)}>
            {activePipeline ? <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay/35 dark:bg-overlay/65" />
              <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[16px] border border-border bg-card p-5 shadow-2xl focus:outline-none sm:p-6" data-testid="delete-pipeline-dialog">
                <DialogPrimitive.Title className="text-base font-semibold text-foreground">{labels.remove}</DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-2 text-sm leading-6 text-muted-foreground">{activePipeline.name} — {labels.confirmDelete}</DialogPrimitive.Description>
                {managementError ? <p className="mt-3 text-sm text-destructive" role="alert">{managementError}</p> : null}
                <div className="mt-5 flex justify-end gap-2">
                  <DialogPrimitive.Close asChild><Button disabled={managementBusy} size="sm" variant="outline">{labels.cancel}</Button></DialogPrimitive.Close>
                  <Button disabled={managementBusy} onClick={() => void confirmPipelineDelete()} size="sm" variant="destructive">{managementBusy ? (preferences.locale === "tr" ? "Siliniyor…" : "Deleting…") : labels.remove}</Button>
                </div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal> : null}
          </DialogPrimitive.Root>
          {editing && managementError ? <p className="mt-2 text-sm text-destructive" role="alert">{managementError}</p> : null}

          {activeDocumentId && !activePipeline ? <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">{labels.noActivePipeline}</p> : null}
          {!activeDocumentId && documents.length > 0 ? <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">{labels.selectDocumentForPipeline}</p> : null}
          {persistenceStatus === "checking" ? <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">{labels.loading}</p> : null}
          {persistenceStatus === "unavailable" ? <div className="mt-4 border-t border-border pt-3"><p className="text-xs leading-5 text-destructive">{labels.unavailable}</p><PipelineErrorMessage message={persistenceError?.message} /></div> : null}
          {persistenceStatus === "available" && documents.length === 0 ? <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">{labels.empty}</p> : null}
        </section>
        </>}

        <section className="mt-6 rounded-[16px] border-[1.712px] border-border bg-card px-5 pb-4 pt-5" data-testid="figma-overview-pipeline">
          <div className="flex min-h-[22px] w-full items-center justify-between gap-4">
            <h2 className="m-0 text-base font-semibold leading-[22px] text-foreground">{labels.journey}</h2>
            <p className="m-0 text-[12.5px] leading-[18.75px] text-subtle-foreground max-sm:hidden">{labels.journeyDescription}</p>
          </div>
          <div className="relative mt-2 w-full overflow-hidden" data-testid="overview-journey">
            <div className="relative hidden h-[216px] w-full pt-3 min-[1440px]:block" data-testid="overview-journey-desktop">
              <div className="relative h-[200px] w-full">
                <div className="absolute top-1 h-[192px] rounded-[14px] border-[1.712px] border-border/60 bg-technical" data-testid="figma-overview-prepare" style={journeyGroupPosition("prepare")}><span className="absolute left-3.5 top-3 font-mono text-[10px] font-medium uppercase leading-[15px] tracking-[0.8px] text-subtle-foreground">{groupLabels.knowledge}</span></div>
                <div className="absolute top-1 h-[192px] rounded-[14px] border-[1.712px] border-border/60 bg-technical" data-testid="figma-overview-test" style={journeyGroupPosition("test")}><span className="absolute left-3.5 top-3 font-mono text-[10px] font-medium uppercase leading-[15px] tracking-[0.8px] text-subtle-foreground">{groupLabels.query}</span></div>
                <div className="absolute top-1 h-[192px] rounded-[14px] border-[1.712px] border-solid border-border/60 bg-accent/60" data-testid="figma-overview-measure" style={journeyGroupPosition("measure")}><span className="absolute left-3.5 top-3 font-mono text-[10px] font-medium uppercase leading-[15px] tracking-[0.8px] text-subtle-foreground">{groupLabels.quality}</span></div>
                <JourneyConnectors stateFor={(step) => pipelineState[step]} />
                {pipelineSteps.map((step) => <JourneyNode href={stageHref[step.key]} key={step.key} labels={journeyLabels} reason={lockedReason(step.key)} state={pipelineState[step.key]} step={step} />)}
              </div>
            </div>
            <div className="min-[1440px]:hidden">
              <JourneyCompact labels={journeyLabels} reasonFor={lockedReason} stateFor={(step) => pipelineState[step]} />
            </div>
          </div>
        </section>

        <div className="mt-5" data-testid="figma-overview-learning-note"><LearningHint locale={preferences.locale}>{labels.whyMattersText}</LearningHint></div>
      </div>
    </div>
  );
}
