import { describe, expect, it } from "vitest";

import {
  buildOverviewViewModel,
  experimentStageToStepState,
  journeyLockReason,
  operationToStepState,
  runToStepState,
} from "@/lib/overview-view-model";
import { countDoneJourneyStages } from "@/lib/workspace-overview";

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

describe("Overview view model", () => {
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
    // A completed experiment extends the continuation chain to Evaluation (N-6).
    expect(complete.continuation).toEqual({ href: "/evaluation", kind: "evaluation", state: "Completed" });

    const lineageOnly = buildOverviewViewModel({ ...overviewInput(), evaluation: undefined, experiment: undefined, hasEvaluationDataset: false });
    expect(lineageOnly.continuation).toEqual({ href: "/playground", kind: "playground", state: "Ready" });
  });

  it("continues from a finished experiment to Evaluation even before a dataset exists", () => {
    const experimentDone = buildOverviewViewModel({ ...overviewInput(), evaluation: undefined, hasEvaluationDataset: false });
    expect(experimentDone.pipelineState.evaluate).toBe("Ready");
    expect(experimentDone.continuation).toEqual({ href: "/evaluation", kind: "evaluation", state: "Ready" });

    const running = buildOverviewViewModel({ ...overviewInput(), evaluation: { status: "running" } });
    expect(running.continuation).toEqual({ href: "/evaluation", kind: "evaluation-processing", state: "Processing" });
    const failed = buildOverviewViewModel({ ...overviewInput(), evaluation: { status: "failed" } });
    expect(failed.continuation).toEqual({ href: "/evaluation", kind: "evaluation-error", state: "Error" });
  });

  it("keeps the Playground as the next step until the experiment has produced an answer", () => {
    for (const target of ["retrieval", "reranking", "context"] as const) {
      const stageStatuses = Object.fromEntries(
        (["retrieval", "reranking", "context"] as const).slice(0, ["retrieval", "reranking", "context"].indexOf(target) + 1).map((stage) => [stage, "completed"]),
      ) as Record<string, "completed">;
      const stopped = buildOverviewViewModel({ ...overviewInput(), evaluation: undefined, hasEvaluationDataset: false, experiment: { status: "completed", stageStatuses } });
      expect(stopped.continuation, target).toEqual({ href: "/playground", kind: "playground", state: "Ready" });
      expect(stopped.pipelineState.evaluate, target).toBe("Locked");
    }
  });

  it("explains locked journey steps by the first unfinished upstream step", () => {
    const embeddingsReady = buildOverviewViewModel({
      ...overviewInput(),
      embedding: undefined,
      embeddingStatus: "ready",
      evaluation: undefined,
      experiment: undefined,
      hasEvaluationDataset: false,
      selectedEmbeddingRunId: null,
    });
    expect(journeyLockReason("embed", embeddingsReady.pipelineState)).toBeNull();
    expect(journeyLockReason("retrieve", embeddingsReady.pipelineState)).toBe("missing_embedding");
    expect(journeyLockReason("generate", embeddingsReady.pipelineState)).toBe("missing_embedding");
    expect(journeyLockReason("evaluate", embeddingsReady.pipelineState)).toBe("missing_embedding");

    const empty = buildOverviewViewModel({ ...overviewInput(), activeDocument: undefined, activeDocumentId: null, parse: undefined, chunk: undefined, embedding: undefined, experiment: undefined, evaluation: undefined, selectedParseRunId: null, selectedChunkRunId: null, selectedEmbeddingRunId: null, chunkStatus: "locked", embeddingStatus: "locked", hasEvaluationDataset: false });
    expect(journeyLockReason("parse", empty.pipelineState)).toBe("missing_document");
    expect(journeyLockReason("chunk", empty.pipelineState)).toBe("missing_document");
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

  it("counts only finished journey stages for the progress readout, skipped included", () => {
    expect(countDoneJourneyStages(buildOverviewViewModel(overviewInput()).pipelineState)).toEqual({ done: 9, total: 9 });
    const embeddingsReady = buildOverviewViewModel({
      ...overviewInput(),
      embedding: undefined,
      evaluation: undefined,
      experiment: undefined,
      hasEvaluationDataset: false,
      selectedEmbeddingRunId: null,
    });
    // Ready and Locked stages are not progress.
    expect(countDoneJourneyStages(embeddingsReady.pipelineState)).toEqual({ done: 3, total: 9 });
  });
});
