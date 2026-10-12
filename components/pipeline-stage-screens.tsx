"use client";

import { useCallback, useState, type ReactNode } from "react";

import { ChunkingWorkspace, EmbeddingWorkspace } from "@/components/chunks-pipeline";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { InspectionBand, RunHistory, StageNextAction } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { HowItWorks } from "@/components/ui/disclosure";
import { PageHeader } from "@/components/ui/page-header";
import { getPipelineAvailability } from "@/lib/blockers";
import { useCopy } from "@/lib/copy";
import type { ChunkStageState } from "@/lib/pipeline-lineage";

/** Page frame shared by the Parsing, Chunking and Embeddings screens. */
export function StagePage({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div className="min-w-0 bg-canvas" data-testid={testId}>
      <div className="mx-auto flex w-full max-w-container min-w-0 flex-col px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">{children}</div>
    </div>
  );
}

/** The active document and pipeline as a breadcrumb above the stage title (switchable in place). */
export function StageContext() {
  return <PipelineContextBar layout="inline" showLineage={false} />;
}

export function ChunkingScreen() {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const { activeDocument, activePipeline, selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId, inspectedChunkRunId, persistenceStatus, workspaceStatus, chunkStatus, selectChunkRun, inspectChunkRun, setPipelineChunkRun } = useDocumentPipeline();
  const chunkRuns = activeDocument?.chunkRuns.filter((run) => run.upstream.parseRunId === selectedParseRunId) ?? [];
  const selectedChunk = chunkRuns.find((run) => run.id === selectedChunkRunId) ?? null;
  const selection = { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId };
  const parseRun = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId) ?? null;
  // Same inputs as the workspace's own action, so the footer can avoid repeating its blocker.
  const stageAvailability = getPipelineAvailability(preferences.locale, "chunk", { document: activeDocument, pipeline: activePipeline, selection, parseRun, processing: chunkStatus === "processing", persistenceStatus, workspaceStatus });
  const nextAvailability = getPipelineAvailability(preferences.locale, "embedding", {
    document: activeDocument,
    pipeline: activePipeline,
    selection,
    parseRun,
    chunkRun: selectedChunk,
    persistenceStatus,
    workspaceStatus,
  });
  const canContinue = Boolean(selectedParseRunId && selectedChunk && selectedChunk.status === "completed" && selectedChunk.isCompatible && chunkStatus !== "processing");
  // A form that differs from the selected run makes "Run chunking" the primary
  // action, so the footer steps back to secondary until the form is applied.
  const [formDirty, setFormDirty] = useState(false);
  const onFormStateChange = useCallback((state: ChunkStageState) => setFormDirty(state.isDirty), []);

  return (
    <StagePage testId="chunking-screen">
      <PageHeader context={<StageContext />} data-testid="chunking-page-header" description={copy.chunking.description} help={<HowItWorks>{copy.chunking.howItWorks}</HowItWorks>} title={copy.nav.chunking} />
      <InspectionBand canUse={Boolean(activePipeline)} inspectedId={inspectedChunkRunId} kind="chunk" onBack={inspectChunkRun} onUse={setPipelineChunkRun} runs={chunkRuns} selectedId={selectedChunkRunId} />
      <ChunkingWorkspace onFormStateChange={onFormStateChange} />
      <RunHistory defaultId={activeDocument?.activeChunkRunId} hasPipeline={Boolean(activePipeline)} inspectedId={inspectedChunkRunId} kind="chunk" onInspect={selectChunkRun} onUse={setPipelineChunkRun} runs={chunkRuns} selectedId={selectedChunkRunId} />
      <StageNextAction blocker={nextAvailability.allowed ? null : nextAvailability} disabled={!canContinue} emphasis={formDirty ? "secondary" : "primary"} href="/embeddings" label={copy.chunking.next} reason={copy.chunking.nextReason} stageBlocker={stageAvailability.allowed ? null : stageAvailability} testId="chunking-next-action" />
    </StagePage>
  );
}

export function EmbeddingsScreen() {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const { activeDocument, activePipeline, selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId, inspectedEmbeddingRunId, selectedEmbeddingRun, persistenceStatus, workspaceStatus, embeddingStatus, selectEmbeddingRun, inspectEmbeddingRun, setPipelineEmbeddingRun } = useDocumentPipeline();
  const embeddingRuns = activeDocument?.embeddingRuns.filter((run) => run.upstream.chunkRunId === selectedChunkRunId) ?? [];
  // The next step follows the selected lineage, never the inspection cursor.
  const canContinue = Boolean(selectedChunkRunId && selectedEmbeddingRunId && selectedEmbeddingRun?.id === selectedEmbeddingRunId && selectedEmbeddingRun?.status === "completed" && selectedEmbeddingRun.isCompatible && selectedEmbeddingRun.upstream.chunkRunId === selectedChunkRunId && embeddingStatus !== "processing");
  const selection = { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId };
  const parseRun = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId) ?? null;
  const chunkRun = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId) ?? null;
  // Same inputs as the workspace's own action, so the footer can avoid repeating its blocker.
  const stageAvailability = getPipelineAvailability(preferences.locale, "embedding", { document: activeDocument, pipeline: activePipeline, selection, parseRun, chunkRun, processing: embeddingStatus === "processing", persistenceStatus, workspaceStatus });
  const nextAvailability = getPipelineAvailability(preferences.locale, "retrieval", {
    document: activeDocument,
    pipeline: activePipeline,
    selection,
    parseRun,
    chunkRun,
    embeddingRun: activeDocument?.embeddingRuns.find((run) => run.id === selectedEmbeddingRunId) ?? null,
    // The Playground question is entered there; only lineage gates the step.
    hasQuestion: true,
    retrievalMode: "dense",
    persistenceStatus,
    workspaceStatus,
  });

  return (
    <StagePage testId="embeddings-screen">
      <PageHeader context={<StageContext />} data-testid="embeddings-page-header" description={copy.embeddings.description} title={copy.nav.embeddings} />
      <InspectionBand canUse={Boolean(activePipeline)} inspectedId={inspectedEmbeddingRunId} kind="embedding" onBack={inspectEmbeddingRun} onUse={setPipelineEmbeddingRun} runs={embeddingRuns} selectedId={selectedEmbeddingRunId} />
      <EmbeddingWorkspace />
      <RunHistory defaultId={activeDocument?.activeEmbeddingRunId} hasPipeline={Boolean(activePipeline)} inspectedId={inspectedEmbeddingRunId} kind="embedding" onInspect={selectEmbeddingRun} onUse={setPipelineEmbeddingRun} runs={embeddingRuns} selectedId={selectedEmbeddingRunId} />
      <StageNextAction blocker={nextAvailability.allowed ? null : nextAvailability} disabled={!canContinue} href="/playground" label={copy.embeddings.next} reason={copy.embeddings.nextReason} stageBlocker={stageAvailability.allowed ? null : stageAvailability} testId="embeddings-next-action" />
    </StagePage>
  );
}
