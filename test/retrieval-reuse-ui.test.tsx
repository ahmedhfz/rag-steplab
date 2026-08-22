import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const pipeline = vi.hoisted(() => {
  const runAgain = vi.fn();
  const continueRun = vi.fn();
  const load = vi.fn();
  return {
    runAgain,
    continueRun,
    load,
    value: {
    activeDocument: { id: "document-1" },
    capabilities: { rerankModel: "gemini-rerank-v1" },
    selectedChunkRunId: "chunk-1",
    selectedEmbeddingRunId: null,
    experimentStatus: "completed",
    experimentError: null,
    experimentHistory: [],
    experimentRun: {
      id: "experiment-1",
      status: "completed",
      progress: null,
      isStale: false,
      isCompatible: true,
      compatibilityReason: null,
      historicalLineage: false,
      upstream: { chunkRunId: "chunk-1" },
      config: { retrieval: { mode: "keyword" } },
      timing: { startedAt: null, completedAt: null, durationMs: 3 },
      error: null,
      documentId: "document-1",
      chunkRunId: "chunk-1",
      embeddingRunId: null,
      query: "retrieval",
      targetStage: "generation",
      experimentFingerprint: "experiment-fingerprint",
      reusedExperiment: true,
      continuedFromExperimentId: null,
      generationRerun: false,
      stageResults: {
        retrieval: { candidates: [], durationMs: 1, reuse: { reused: true, executed: false, sourceExperimentId: "source-1", sourceDurationMs: 1 } },
        reranking: { candidates: [], durationMs: 1, method: null, executed: false, reuse: { reused: true, executed: false, sourceExperimentId: "source-1", sourceDurationMs: 1 } },
        context: { candidates: [], finalContext: "", tokenBudget: 3000, tokenCount: 0, durationMs: 1, reuse: { reused: true, executed: false, sourceExperimentId: "source-1", sourceDurationMs: 1 } },
        generation: { answer: "Answer", citations: [], model: "gemini-generation-v1", inputTokens: null, outputTokens: null, durationMs: 1, insufficientContext: false, reuse: { reused: false, executed: true, sourceExperimentId: null, sourceDurationMs: null } },
      },
    },
    runExperiment: vi.fn(),
      loadExperiment: load,
      continueExperiment: continueRun,
      rerunGeneration: runAgain,
    },
  };
});

vi.mock("@/components/document-pipeline-provider", () => ({
  useDocumentPipeline: () => pipeline.value,
}));

import { PreferencesProvider } from "@/components/preferences-provider";
import { RetrievalScreen } from "@/components/retrieval-screen";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Retrieval reuse UI contract", () => {
  it("shows truthful stage metadata and exposes explicit generation rerun", async () => {
    const user = userEvent.setup();
    render(<PreferencesProvider><RetrievalScreen /></PreferencesProvider>);

    expect(screen.getByText("Exact experiment loaded")).toBeInTheDocument();
    expect(screen.getByTestId("stage-reuse-retrieval")).toHaveTextContent("Reused");
    expect(screen.getByTestId("stage-reuse-generation")).toHaveTextContent("Executed");
    await user.click(screen.getByRole("button", { name: "Run generation again" }));
    expect(pipeline.runAgain).toHaveBeenCalledTimes(1);
  });
});
