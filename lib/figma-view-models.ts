import type { ExperimentSummary, RunStatus, RunSummary } from "@/lib/rag-api-types";
import type { PipelineStepKey, PipelineStepState } from "@/lib/rag-ui-types";

export type PipelineOperationStatusLike = "locked" | "ready" | "processing" | "completed" | "skipped" | "error" | "stale";
export type OverviewContinuationKind =
  | "checking"
  | "document"
  | "parse-processing"
  | "parse-error"
  | "parse"
  | "chunk-processing"
  | "chunk-error"
  | "chunk"
  | "embedding-processing"
  | "embedding-error"
  | "embedding"
  | "playground";

export type OverviewViewModel = {
  pipelineState: Record<PipelineStepKey, PipelineStepState>;
  continuation: {
    href: string;
    kind: OverviewContinuationKind;
    state: PipelineStepState;
  };
};

type RunLike = Pick<RunSummary, "status"> & Partial<Pick<RunSummary, "isCompatible">>;

export function operationToStepState(status: PipelineOperationStatusLike): PipelineStepState {
  if (status === "processing") return "Processing";
  if (status === "error") return "Error";
  if (status === "completed") return "Completed";
  if (status === "ready") return "Ready";
  if (status === "stale") return "Stale";
  if (status === "skipped") return "Skipped";
  return "Locked";
}

export function runToStepState(status: RunStatus): PipelineStepState {
  if (status === "queued" || status === "running") return "Processing";
  if (status === "completed") return "Completed";
  return "Error";
}

export function experimentStageToStepState(
  experiment: Pick<ExperimentSummary, "stageStatuses" | "status"> | undefined,
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

export function buildOverviewViewModel({
  activeDocument,
  activeDocumentId,
  chunk,
  chunkStatus,
  embedding,
  embeddingStatus,
  evaluation,
  hasEvaluationDataset,
  experiment,
  parse,
  persistenceStatus,
  selectedChunkRunId,
  selectedEmbeddingRunId,
  selectedParseRunId,
}: {
  activeDocument?: { parseRuns: RunLike[] };
  activeDocumentId: string | null;
  chunk?: RunLike;
  chunkStatus: PipelineOperationStatusLike;
  embedding?: RunLike;
  embeddingStatus: PipelineOperationStatusLike;
  evaluation?: RunLike;
  hasEvaluationDataset: boolean;
  experiment?: Pick<ExperimentSummary, "stageStatuses" | "status">;
  parse?: RunLike;
  persistenceStatus: "checking" | "available" | "unavailable";
  selectedChunkRunId: string | null;
  selectedEmbeddingRunId: string | null;
  selectedParseRunId: string | null;
}): OverviewViewModel {
  const hasDocument = Boolean(activeDocumentId);
  const parseState: PipelineStepState = !hasDocument
    ? "Locked"
    : parse?.status === "completed" && parse.isCompatible
      ? "Completed"
      : activeDocument?.parseRuns.some((run) => run.status === "queued" || run.status === "running")
        ? "Processing"
        : activeDocument?.parseRuns[0]?.status === "failed"
          ? "Error"
          : "Ready";
  const chunkState = chunk?.status === "completed" && chunk.isCompatible ? "Completed" : operationToStepState(chunkStatus);
  const embeddingState = embedding?.status === "completed" && embedding.isCompatible ? "Completed" : operationToStepState(embeddingStatus);
  const evaluationState: PipelineStepState = evaluation
    ? evaluation.status === "completed"
      ? "Completed"
      : evaluation.status === "running" || evaluation.status === "queued"
        ? "Processing"
        : "Error"
    : selectedChunkRunId && selectedEmbeddingRunId && hasEvaluationDataset
      ? "Ready"
      : "Locked";

  let continuation: OverviewViewModel["continuation"];
  if (persistenceStatus === "checking") continuation = { href: "/documents", kind: "checking", state: "Processing" };
  else if (!activeDocument) continuation = { href: "/documents", kind: "document", state: "Ready" };
  else if (parseState === "Processing") continuation = { href: "/parse", kind: "parse-processing", state: "Processing" };
  else if (parseState === "Error") continuation = { href: "/parse", kind: "parse-error", state: "Error" };
  else if (!selectedParseRunId || parseState === "Ready") continuation = { href: "/parse", kind: "parse", state: "Ready" };
  else if (chunkState === "Processing") continuation = { href: "/chunking", kind: "chunk-processing", state: "Processing" };
  else if (chunkState === "Error" || chunkState === "Stale") continuation = { href: "/chunking", kind: "chunk-error", state: chunkState };
  else if (!selectedChunkRunId || chunkState === "Ready") continuation = { href: "/chunking", kind: "chunk", state: "Ready" };
  else if (embeddingState === "Processing") continuation = { href: "/embeddings", kind: "embedding-processing", state: "Processing" };
  else if (embeddingState === "Error" || embeddingState === "Stale") continuation = { href: "/embeddings", kind: "embedding-error", state: embeddingState };
  else if (!selectedEmbeddingRunId || embeddingState === "Ready") continuation = { href: "/embeddings", kind: "embedding", state: "Ready" };
  else continuation = { href: "/playground", kind: "playground", state: "Ready" };

  return {
    continuation,
    pipelineState: {
      document: hasDocument ? "Completed" : "Not started",
      parse: parseState,
      chunk: chunkState,
      embed: embeddingState,
      index: embeddingState,
      retrieve: experimentStageToStepState(experiment, "retrieval", Boolean(selectedChunkRunId)),
      rerank: experimentStageToStepState(experiment, "reranking", Boolean(selectedChunkRunId)),
      context: experimentStageToStepState(experiment, "context", Boolean(selectedChunkRunId)),
      generate: experimentStageToStepState(experiment, "generation", Boolean(selectedChunkRunId)),
      evaluate: evaluationState,
    },
  };
}
