"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronDown, Info } from "lucide-react";
import { useState } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { StatusIndicator } from "@/components/status-indicator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UI_COPY } from "@/lib/copy";
import { blocker, type BlockerCode } from "@/lib/blockers";
import { buildOverviewViewModel } from "@/lib/figma-view-models";
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
        lineage: "Current indexing lineage",
        journey: "Pipeline journey",
        journeyDescription: "Seçili workspace'in build ve deney aşamalarına geçin.",
        whyMatters: "Bu neden önemli?",
        whyMattersText: "Parse, chunk ve embedding seçimleri aşağı akıştaki retrieval sonucunu değiştirir. Her aşamayı seçili lineage üzerinden inceleyin.",
        empty: "Henüz doküman yok. Başlamak için Documents ekranından bir PDF ekleyin.",
        documentsCta: "Documents'a git",
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
        lineage: "Current indexing lineage",
        journey: "Pipeline journey",
        journeyDescription: "Open the build and experiment stages for this workspace.",
        whyMatters: "Why this matters",
        whyMattersText: "Parse, chunk, and embedding choices change downstream retrieval. Inspect each stage through the selected lineage.",
        empty: "No documents yet. Add a PDF from Documents to begin.",
        documentsCta: "Go to Documents",
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
    if (!name || !activeDocumentId) return;
    if (editing === "create") await createPipeline(name);
    if (editing === "rename" && activePipeline) await renamePipeline(activePipeline.id, name);
    setEditing(null);
    setPipelineName("");
  }

  function beginCreatePipeline() {
    setConfirmDelete(false);
    setEditing("create");
    setPipelineName("");
  }

  function beginRenamePipeline() {
    if (!activePipeline) return;
    setConfirmDelete(false);
    setEditing("rename");
    setPipelineName(activePipeline.name);
  }

  const lineageItems: Array<{ key: "parse" | "chunk" | "embed"; href: string; label: string; state: PipelineStepState }> = [
    { key: "parse", href: "/parse", label: "Parse", state: pipelineState.parse },
    { key: "chunk", href: "/chunking", label: "Chunk", state: pipelineState.chunk },
    { key: "embed", href: "/embeddings", label: "Embedding", state: pipelineState.embed },
  ];

  return (
    <div className="min-w-0 overflow-x-clip bg-[#f8f7f7]" data-testid="figma-overview-root">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4" data-testid="figma-overview-main">
        <header className="min-h-[82px] w-full" data-testid="figma-overview-header">
          <h1 className="m-0 text-[28px] font-semibold leading-[34px] tracking-[-0.56px] text-[#171416]">{copy.overview.title}</h1>
          <p className="mt-[6px] w-full max-w-[640px] text-sm leading-[21px] text-[#6e676a]">{labels.description}</p>
        </header>

        <section className="mt-7 rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white p-5" data-testid="workspace-control-plane">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold uppercase leading-[19.5px] tracking-[0.78px] text-[#969093]">{labels.workspace}</p>
              <p className="mt-1 text-xs leading-[18px] text-[#6e676a]">{labels.workspaceHint}</p>
              <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <label className="mb-1.5 block text-xs font-medium text-[#171416]" htmlFor="overview-document">{labels.document}</label>
                  <Select disabled={persistenceStatus !== "available" || documents.length === 0} onValueChange={(value) => void selectPersistedDocument(value)} value={activeDocumentId ?? ""}>
                    <SelectTrigger aria-label={labels.document} className="h-10 min-w-0" data-testid="overview-document-selector" id="overview-document"><SelectValue placeholder={labels.chooseDocument} /></SelectTrigger>
                    <SelectContent>{documents.map((document) => <SelectItem key={document.id} value={document.id}>{document.fileName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="min-w-0">
                  <label className="mb-1.5 block text-xs font-medium text-[#171416]" htmlFor="overview-pipeline">{labels.pipeline}</label>
                  <Select disabled={!activeDocumentId || pipelines.length === 0} onValueChange={(value) => void selectPipeline(value === "none" ? null : value)} value={activePipelineId ?? "none"}>
                    <SelectTrigger aria-label={labels.pipeline} className="h-10 min-w-0" data-testid="overview-pipeline-selector" id="overview-pipeline"><SelectValue placeholder={labels.noPipeline} /></SelectTrigger>
                    <SelectContent><SelectItem value="none">{labels.noPipeline}</SelectItem>{pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}{pipeline.isDefault ? " · default" : ""}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button disabled={!activeDocumentId || persistenceStatus !== "available"} onClick={beginCreatePipeline} size="sm" variant="secondary">{labels.newPipeline}</Button>
              <Button disabled={!activePipeline} onClick={beginRenamePipeline} size="sm" variant="outline">{labels.rename}</Button>
              <Button disabled={!activePipeline} onClick={() => { setEditing(null); setConfirmDelete(true); }} size="sm" variant="ghost">{labels.remove}</Button>
            </div>
          </div>

          {editing ? (
            <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-[#e7e2e4] pt-4" data-testid="pipeline-name-editor">
              <label className="sr-only" htmlFor="overview-pipeline-name">{labels.namePlaceholder}</label>
              <Input autoFocus className="max-w-sm" id="overview-pipeline-name" maxLength={100} onChange={(event) => setPipelineName(event.target.value)} placeholder={labels.namePlaceholder} value={pipelineName} />
              <Button disabled={!pipelineName.trim()} onClick={() => void savePipelineName()} size="sm">{labels.save}</Button>
              <Button onClick={() => setEditing(null)} size="sm" variant="ghost">{labels.cancel}</Button>
            </div>
          ) : null}

          {confirmDelete && activePipeline ? (
            <div aria-describedby="delete-pipeline-description" aria-labelledby="delete-pipeline-title" aria-modal="true" className="mt-4 rounded-[10px] border border-[#eadfc9] bg-[#fffaf1] p-4" data-testid="delete-pipeline-dialog" role="dialog">
              <h2 className="text-sm font-semibold" id="delete-pipeline-title">{labels.remove}</h2>
              <p className="mt-1 text-sm text-[#6e676a]" id="delete-pipeline-description">{labels.confirmDelete}</p>
              <div className="mt-3 flex gap-2">
                <Button onClick={() => setConfirmDelete(false)} size="sm" variant="outline">{labels.cancel}</Button>
                <Button onClick={() => { void deletePipeline(activePipeline.id); setConfirmDelete(false); }} size="sm" variant="destructive">{labels.remove}</Button>
              </div>
            </div>
          ) : null}

          {activeDocumentId && !activePipeline ? <p className="mt-4 border-t border-[#e7e2e4] pt-3 text-xs leading-5 text-[#6e676a]">{labels.noActivePipeline}</p> : null}
          {!activeDocumentId && documents.length > 0 ? <p className="mt-4 border-t border-[#e7e2e4] pt-3 text-xs leading-5 text-[#6e676a]">{labels.selectDocumentForPipeline}</p> : null}
          {persistenceStatus === "checking" ? <p className="mt-4 border-t border-[#e7e2e4] pt-3 text-xs leading-5 text-[#6e676a]">{labels.loading}</p> : null}
          {persistenceStatus === "unavailable" ? <div className="mt-4 border-t border-[#e7e2e4] pt-3"><p className="text-xs leading-5 text-[#a23b3b]">{labels.unavailable}</p><PipelineErrorMessage message={persistenceError?.message} /></div> : null}
          {persistenceStatus === "available" && documents.length === 0 ? <p className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#e7e2e4] pt-3 text-xs leading-5 text-[#6e676a]"><span>{labels.empty}</span><Link className="font-medium text-[#711f3a] underline-offset-2 hover:underline" href="/documents">{labels.documentsCta}</Link></p> : null}
        </section>

        <section className="mt-4 rounded-[14px] border-[1.712px] border-[#e7e2e4] bg-white px-4 py-3.5 sm:px-5" data-testid="overview-lineage">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase leading-[16.5px] tracking-[0.66px] text-[#969093]">{labels.lineage}</p>
              <p className="mt-1 max-w-[31rem] truncate text-xs text-[#6e676a]" title={`${activeDocument?.fileName ?? labels.chooseDocument} / ${activePipeline?.name ?? labels.noPipeline}`}>
                {activeDocument?.fileName ?? labels.chooseDocument} <span className="text-[#d8d2d5]">/</span> {activePipeline?.name ?? labels.noPipeline}
              </p>
            </div>
            <nav aria-label={labels.lineage} className="flex min-w-0 flex-wrap items-center gap-2">
              {lineageItems.map((item, index) => (
                <span className="flex items-center gap-2" key={item.key}>
                  {index > 0 ? <span aria-hidden="true" className="text-[#d8d2d5]">→</span> : null}
                  <Link className="flex min-w-0 items-center gap-2 rounded-[8px] px-1.5 py-1 outline-none hover:bg-[#fbf4f6] focus-visible:ring-2 focus-visible:ring-[#711f3a]/25" data-testid={`overview-lineage-${item.key}`} href={item.href}>
                    <span className="text-xs font-medium text-[#171416]">{item.label}</span>
                    <StatusIndicator state={item.state} />
                  </Link>
                </span>
              ))}
            </nav>
          </div>
        </section>

        <section className="mt-6 rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white px-5 pb-4 pt-5 max-lg:overflow-x-auto" data-testid="figma-overview-pipeline">
          <div className="flex min-h-[22px] w-full items-center justify-between gap-4">
            <h2 className="m-0 text-base font-semibold leading-[22px] text-[#171416]">{labels.journey}</h2>
            <p className="m-0 text-[12.5px] leading-[18.75px] text-[#969093] max-sm:hidden">{labels.journeyDescription}</p>
          </div>
          <div className="relative mt-2 h-[216px] w-full min-w-[780px] overflow-hidden pt-3" data-testid="overview-journey">
            <div className="relative h-[200px] w-full min-w-[780px]">
              <div className="absolute left-[25.034px] top-1 h-[192px] w-[441px] rounded-[14px] border-[1.712px] border-[rgba(231,226,228,0.6)] bg-[#fbfafb]" data-testid="figma-overview-prepare"><span className="absolute left-3.5 top-3 font-mono text-[10px] font-medium uppercase leading-[15px] tracking-[0.8px] text-[#969093]">{groupLabels.knowledge}</span></div>
              <div className="absolute left-[476.356px] top-1 h-[192px] w-[428px] rounded-[14px] border-[1.712px] border-[rgba(231,226,228,0.6)] bg-[#fbfafb]" data-testid="figma-overview-test"><span className="absolute left-3.5 top-3 font-mono text-[10px] font-medium uppercase leading-[15px] tracking-[0.8px] text-[#969093]">{groupLabels.query}</span></div>
              <div className="absolute left-[914.809px] top-1 h-[192px] w-[114px] rounded-[14px] border-[1.712px] border-solid border-[rgba(231,226,228,0.6)] bg-[rgba(251,244,246,0.6)]" data-testid="figma-overview-measure"><span className="absolute left-3.5 top-3 font-mono text-[10px] font-medium uppercase leading-[15px] tracking-[0.8px] text-[#969093]">{groupLabels.quality}</span></div>
              <Image alt="" className="pointer-events-none absolute left-[-0.05px] top-px h-[199.975px] w-[1054.1px] max-w-none" height={200} priority src="/assets/figma/overview/icon.svg" width={1054} />
              {pipelineSteps.map((step) => <JourneyNode href={stageHref[step.key]} key={step.key} labels={journeyLabels} reason={lockedReason(step.key)} state={pipelineState[step.key]} step={step} />)}
            </div>
          </div>
        </section>

        <details className="mt-5 rounded-[12px] border-[1.712px] border-[#f3d9e0] bg-[#fbf4f6]" data-testid="figma-overview-learning-note">
          <summary className="flex min-h-[46px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px] font-medium text-[#501329] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#711f3a]/25">
            <span className="flex items-center gap-2"><Info aria-hidden="true" className="size-4" />{labels.whyMatters}</span>
            <ChevronDown aria-hidden="true" className="size-4 text-[#969093]" />
          </summary>
          <p className="border-t border-[#f3d9e0] px-4 py-3 text-xs leading-5 text-[rgba(59,13,29,0.75)]">{labels.whyMattersText}</p>
        </details>
      </div>
    </div>
  );
}
