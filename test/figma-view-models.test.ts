import { describe, expect, it } from "vitest";

import {
  buildOverviewViewModel,
  experimentStageToStepState,
  operationToStepState,
  runToStepState,
} from "@/lib/figma-view-models";

const completeRun = {
  status: "completed" as const,
  isCompatible: true,
};

function overviewInput(overrides: Partial<Parameters<typeof buildOverviewViewModel>[0]> = {}) {
  return {
    activeDocument: { parseRuns: [completeRun] },
    activeDocumentId: "document-1",
    chunk: completeRun,
    chunkStatus: "ready" as const,
    embedding: completeRun,
    embeddingStatus: "ready" as const,
    evaluation: completeRun,
    hasEvaluationDataset: true,
    experiment: {
      status: "completed" as const,
      stageStatuses: {
        retrieval: "completed" as const,
        reranking: "skipped" as const,
        context: "completed" as const,
        generation: "completed" as const,
      },
    },
    parse: completeRun,
    persistenceStatus: "available" as const,
    selectedChunkRunId: "chunk-1",
    selectedEmbeddingRunId: "embedding-1",
    selectedParseRunId: "parse-1",
    ...overrides,
  };
}

describe("Figma presentation state adapters", () => {
  it("maps backend operation states to the canonical pipeline vocabulary", () => {
    expect(operationToStepState("locked")).toBe("Locked");
    expect(operationToStepState("ready")).toBe("Ready");
    expect(operationToStepState("processing")).toBe("Processing");
    expect(operationToStepState("completed")).toBe("Completed");
    expect(operationToStepState("skipped")).toBe("Skipped");
    expect(operationToStepState("error")).toBe("Error");
    expect(operationToStepState("stale")).toBe("Stale");
  });

  it("keeps queued and running jobs visibly processing without inventing completion", () => {
    expect(runToStepState("queued")).toBe("Processing");
    expect(runToStepState("running")).toBe("Processing");
    expect(runToStepState("completed")).toBe("Completed");
    expect(runToStepState("failed")).toBe("Error");
  });

  it("derives experiment stages from real stage status and upstream availability", () => {
    expect(experimentStageToStepState(undefined, "retrieval", false)).toBe("Locked");
    expect(experimentStageToStepState(undefined, "retrieval", true)).toBe("Ready");
    expect(experimentStageToStepState(undefined, "context", true)).toBe("Locked");
    expect(experimentStageToStepState({ status: "completed", stageStatuses: { retrieval: "completed" } }, "retrieval", true)).toBe("Completed");
    expect(experimentStageToStepState({ status: "completed", stageStatuses: { reranking: "skipped" } }, "reranking", true)).toBe("Skipped");
    expect(experimentStageToStepState({ status: "running", stageStatuses: {} }, "retrieval", true)).toBe("Processing");
  });

  it("routes an empty workspace to Documents and a complete lineage to Playground", () => {
    const empty = buildOverviewViewModel({
      ...overviewInput(),
      activeDocument: undefined,
      activeDocumentId: null,
      chunk: undefined,
      embedding: undefined,
      evaluation: undefined,
      hasEvaluationDataset: false,
      experiment: undefined,
      parse: undefined,
      selectedChunkRunId: null,
      selectedEmbeddingRunId: null,
      selectedParseRunId: null,
    });

    expect(empty.pipelineState.document).toBe("Ready");
    expect(empty.pipelineState.parse).toBe("Locked");
    expect(empty.continuation).toEqual({ href: "/documents", kind: "document", state: "Ready" });

    const complete = buildOverviewViewModel(overviewInput());
    expect(complete.pipelineState).toMatchObject({
      document: "Completed",
      parse: "Completed",
      chunk: "Completed",
      embed: "Completed",
      retrieve: "Completed",
      rerank: "Skipped",
      context: "Completed",
      generate: "Completed",
      evaluate: "Completed",
    });
    expect(complete.continuation).toEqual({ href: "/playground", kind: "playground", state: "Ready" });
  });

  it("preserves processing and stale/error continuation states", () => {
    const processing = buildOverviewViewModel({
      ...overviewInput(),
      activeDocument: { parseRuns: [{ status: "queued", isCompatible: false }] },
      parse: { status: "queued", isCompatible: false },
    });
    expect(processing.pipelineState.parse).toBe("Processing");
    expect(processing.continuation).toEqual({ href: "/parse", kind: "parse-processing", state: "Processing" });

    const staleChunk = buildOverviewViewModel({
      ...overviewInput(),
      chunk: undefined,
      chunkStatus: "stale",
      selectedChunkRunId: "chunk-stale",
    });
    expect(staleChunk.pipelineState.chunk).toBe("Stale");
    expect(staleChunk.continuation).toEqual({ href: "/chunking", kind: "chunk-error", state: "Stale" });
  });

  it("keeps only Embeddings Ready when retrieval is technically available downstream", () => {
    const embeddingsReady = buildOverviewViewModel({
      ...overviewInput(),
      embedding: undefined,
      embeddingStatus: "ready",
      evaluation: undefined,
      experiment: undefined,
      hasEvaluationDataset: false,
      selectedEmbeddingRunId: null,
    });

    expect(embeddingsReady.pipelineState).toMatchObject({
      document: "Completed",
      parse: "Completed",
      chunk: "Completed",
      embed: "Ready",
      retrieve: "Locked",
      rerank: "Locked",
      context: "Locked",
      generate: "Locked",
      evaluate: "Locked",
    });
    expect(embeddingsReady.continuation).toEqual({ href: "/embeddings", kind: "embedding", state: "Ready" });
  });
});
