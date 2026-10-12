import type { DocumentPipelineContextValue } from "@/components/document-pipeline-provider";
import { JOURNEY_STAGE_KEYS } from "@/lib/overview-journey";
import { buildOverviewViewModel, type OverviewViewModel } from "@/lib/overview-view-model";
import type { PipelineStepState } from "@/lib/rag-ui-types";

export type WorkspaceOverviewInput = Pick<
  DocumentPipelineContextValue,
  | "activeDocument"
  | "activeDocumentId"
  | "chunkStatus"
  | "embeddingStatus"
  | "persistenceStatus"
  | "selectedChunkRunId"
  | "selectedEmbeddingRunId"
  | "selectedParseRunId"
  | "workspaceStatus"
>;

/**
 * The journey state of the selected document + pipeline lineage. One derivation for the
 * Overview journey and the sidebar stage markers, so both always agree.
 */
export function buildWorkspaceOverview({
  activeDocument,
  activeDocumentId,
  chunkStatus,
  embeddingStatus,
  persistenceStatus,
  selectedChunkRunId,
  selectedEmbeddingRunId,
  selectedParseRunId,
  workspaceStatus,
}: WorkspaceOverviewInput): OverviewViewModel {
  const parse = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId);
  const chunk = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId);
  const embedding = activeDocument?.embeddingRuns.find((run) => run.id === selectedEmbeddingRunId);
  const experiment = activeDocument?.experiments.find(
    (run) => run.isCompatible && run.chunkRunId === selectedChunkRunId && (run.embeddingRunId === null || run.embeddingRunId === selectedEmbeddingRunId),
  );
  const datasetIds = new Set(
    activeDocument?.evaluationDatasets.filter((dataset) => dataset.parseRunId === selectedParseRunId).map((dataset) => dataset.id) ?? [],
  );
  const evaluation = activeDocument?.evaluationRuns.find(
    (run) => datasetIds.has(run.datasetId) && run.chunkRunId === selectedChunkRunId && run.embeddingRunId === selectedEmbeddingRunId,
  );
  return buildOverviewViewModel({
    activeDocument: activeDocument ? { parseRuns: activeDocument.parseRuns } : undefined,
    activeDocumentId,
    chunk,
    chunkStatus,
    embedding,
    embeddingStatus,
    evaluation,
    experiment,
    hasEvaluationDataset: datasetIds.size > 0,
    parse,
    // While the active lineage is still loading, the continuation stays neutral.
    persistenceStatus: workspaceStatus === "loading" && persistenceStatus === "available" ? "checking" : persistenceStatus,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    selectedParseRunId,
  });
}

const DONE_STATES = new Set<PipelineStepState>(["Completed", "Skipped"]);

/** Journey stages whose output exists for this lineage (skipped counts as done). */
export function countDoneJourneyStages(pipelineState: OverviewViewModel["pipelineState"]) {
  return { done: JOURNEY_STAGE_KEYS.filter((key) => DONE_STATES.has(pipelineState[key])).length, total: JOURNEY_STAGE_KEYS.length };
}
