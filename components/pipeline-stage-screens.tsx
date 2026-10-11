"use client";

import { useCallback, useState } from "react";

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

/** Context card shared by the Parsing, Chunking and Embeddings pages. */
export function StageContextCard({ className = "mt-6 w-fit max-w-full" }: { className?: string }) {
  return (
    <div className={`${className} overflow-hidden rounded-lg border border-border bg-card [&>[data-testid=pipeline-context-bar]]:border-b-0`}>
      <PipelineContextBar showLineage={false} />
    </div>
  );
}

export function ChunkingScreen() {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const { activeDocument, activePipeline, selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId, inspectedChunkRunId, persistenceStatus, workspaceStatus, chunkStatus, selectChunkRun, inspectChunkRun, setPipelineChunkRun } = useDocumentPipeline();
  const chunkRuns = activeDocument?.chunkRuns.filter((run) => run.upstream.parseRunId === selectedParseRunId) ?? [];
  const selectedChunk = chunkRuns.find((run) => run.id === selectedChunkRunId) ?? null;
  const nextAvailability = getPipelineAvailability(preferences.locale, "embedding", {
    document: activeDocument,
    pipeline: activePipeline,
    selection: { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId },
    parseRun: activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId) ?? null,
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
    <div className="min-w-0 overflow-x-clip bg-background" data-testid="chunking-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <PageHeader data-testid="chunking-page-header" description={copy.chunking.description} help={<HowItWorks>{copy.chunking.howItWorks}</HowItWorks>} title={copy.nav.chunking} />
        <StageContextCard />
        <InspectionBand canUse={Boolean(activePipeline)} inspectedId={inspectedChunkRunId} kind="chunk" onBack={inspectChunkRun} onUse={setPipelineChunkRun} runs={chunkRuns} selectedId={selectedChunkRunId} />
        <ChunkingWorkspace onFormStateChange={onFormStateChange} />
        <RunHistory defaultId={activeDocument?.activeChunkRunId} hasPipeline={Boolean(activePipeline)} inspectedId={inspectedChunkRunId} kind="chunk" onInspect={selectChunkRun} onUse={setPipelineChunkRun} runs={chunkRuns} selectedId={selectedChunkRunId} />
        <StageNextAction blocker={nextAvailability.allowed ? null : nextAvailability} disabled={!canContinue} emphasis={formDirty ? "secondary" : "primary"} href="/embeddings" label={copy.chunking.next} reason={copy.chunking.nextReason} testId="chunking-next-action" />
      </div>
    </div>
  );
}

export function EmbeddingsScreen() {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const { activeDocument, activePipeline, selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId, inspectedEmbeddingRunId, selectedEmbeddingRun, persistenceStatus, workspaceStatus, embeddingStatus, selectEmbeddingRun, inspectEmbeddingRun, setPipelineEmbeddingRun } = useDocumentPipeline();
  const embeddingRuns = activeDocument?.embeddingRuns.filter((run) => run.upstream.chunkRunId === selectedChunkRunId) ?? [];
  // The next step follows the selected lineage, never the inspection cursor.
  const canContinue = Boolean(selectedChunkRunId && selectedEmbeddingRunId && selectedEmbeddingRun?.id === selectedEmbeddingRunId && selectedEmbeddingRun?.status === "completed" && selectedEmbeddingRun.isCompatible && selectedEmbeddingRun.upstream.chunkRunId === selectedChunkRunId && embeddingStatus !== "processing");
  const nextAvailability = getPipelineAvailability(preferences.locale, "retrieval", {
    document: activeDocument,
    pipeline: activePipeline,
    selection: { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId },
    parseRun: activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId) ?? null,
    chunkRun: activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId) ?? null,
    embeddingRun: activeDocument?.embeddingRuns.find((run) => run.id === selectedEmbeddingRunId) ?? null,
    // The Playground question is entered there; only lineage gates the step.
    hasQuestion: true,
    retrievalMode: "dense",
    persistenceStatus,
    workspaceStatus,
  });

  return (
    <div className="min-w-0 overflow-x-clip bg-background" data-testid="embeddings-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <PageHeader data-testid="embeddings-page-header" description={copy.embeddings.description} title={copy.nav.embeddings} />
        <StageContextCard />
        <InspectionBand canUse={Boolean(activePipeline)} inspectedId={inspectedEmbeddingRunId} kind="embedding" onBack={inspectEmbeddingRun} onUse={setPipelineEmbeddingRun} runs={embeddingRuns} selectedId={selectedEmbeddingRunId} />
        <EmbeddingWorkspace />
        <RunHistory defaultId={activeDocument?.activeEmbeddingRunId} hasPipeline={Boolean(activePipeline)} inspectedId={inspectedEmbeddingRunId} kind="embedding" onInspect={selectEmbeddingRun} onUse={setPipelineEmbeddingRun} runs={embeddingRuns} selectedId={selectedEmbeddingRunId} />
        <StageNextAction blocker={nextAvailability.allowed ? null : nextAvailability} disabled={!canContinue} href="/playground" label={copy.embeddings.next} reason={copy.embeddings.nextReason} testId="embeddings-next-action" />
      </div>
    </div>
  );
}
