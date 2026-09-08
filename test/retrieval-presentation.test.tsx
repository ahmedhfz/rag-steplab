import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pipeline = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/components/document-pipeline-provider", () => ({
  useDocumentPipeline: () => pipeline.value,
}));

import { PreferencesProvider } from "@/components/preferences-provider";
import { RetrievalScreen } from "@/components/retrieval-screen";
import type { ExperimentRun } from "@/lib/rag-api-types";

function buildRun(generation: { answer: string; insufficientContext: boolean }): ExperimentRun {
  return {
    id: "experiment-1",
    status: "completed",
    progress: null,
    isStale: false,
    isCompatible: true,
    compatibilityReason: null,
    historicalLineage: false,
    upstream: { chunkRunId: "chunk-1" },
    config: {
      retrieval: { mode: "hybrid", topK: 5 },
      reranking: { enabled: false, candidateCount: 10 },
      context: { tokenBudget: 3000 },
      generation: { temperature: 0.1, maxOutputTokens: 1024 },
    },
    timing: { startedAt: null, completedAt: null, durationMs: 12 },
    error: null,
    documentId: "document-1",
    chunkRunId: "chunk-1",
    embeddingRunId: "embedding-1",
    query: "What is the laboratory beacon code?",
    targetStage: "generation",
    experimentFingerprint: "experiment-fingerprint",
    reusedExperiment: false,
    continuedFromExperimentId: null,
    generationRerun: false,
    stageResults: {
      retrieval: { candidates: [], durationMs: 1 },
      reranking: { candidates: [], durationMs: 1, method: null, executed: false },
      context: { candidates: [], finalContext: "", tokenBudget: 3000, tokenCount: 0, durationMs: 1 },
      generation: { ...generation, citations: [], model: "gemini-generation-v1", inputTokens: null, outputTokens: null, durationMs: 10 },
    },
  };
}

function renderRetrieval() {
  return render(<PreferencesProvider><RetrievalScreen /></PreferencesProvider>);
}

beforeEach(() => {
  pipeline.value = {
    activeDocument: { id: "document-1" },
    parseResult: null,
    selectedChunkRunId: "chunk-1",
    selectedEmbeddingRunId: "embedding-1",
    experimentStatus: "completed",
    experimentError: null,
    experimentHistory: [],
    experimentRun: buildRun({ answer: "", insufficientContext: true }),
    runExperiment: vi.fn(),
    loadExperiment: vi.fn(),
    continueExperiment: vi.fn(),
    rerunGeneration: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("Playground presentation states", () => {
  it("restores saved settings once and preserves edits across polling updates", () => {
    const view = renderRetrieval();
    const question = screen.getByRole("textbox", { name: "Question" });
    expect(question).toHaveValue("What is the laboratory beacon code?");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
    fireEvent.change(question, { target: { value: "My draft" } });
    const state = pipeline.value as { experimentRun: ExperimentRun };
    state.experimentRun = { ...state.experimentRun };
    view.rerender(<PreferencesProvider><RetrievalScreen /></PreferencesProvider>);
    expect(question).toHaveValue("My draft");
    expect(screen.getByText("Unsaved changes")).toBeVisible();
  });

  it.each([false, true])("reports clipboard success/failure (failure=%s)", async (fails) => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockImplementation(() => fails ? Promise.reject(new Error("denied")) : Promise.resolve()) } });
    renderRetrieval();
    fireEvent.click(screen.getByRole("button", { name: "Copy trace" }));
    await waitFor(() => expect(screen.getByText(fails ? "Copy failed. Try again." : "Trace copied.")).toBeVisible());
  });
  it("clears clipboard feedback after two seconds", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    renderRetrieval();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy trace" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Trace copied.")).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
    expect(screen.getByText("Trace copied.")).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.queryByText("Trace copied.")).not.toBeInTheDocument();
  });
  it("shows a simple insufficient-context state instead of a blank answer", async () => {
    renderRetrieval();

    await within(screen.getByTestId("experiment-stage-trace")).getByRole("button", { name: /^Answer/ }).click();

    expect(screen.getByTestId("playground-insufficient-context")).toBeVisible();
    expect(screen.getByTestId("playground-insufficient-context")).toHaveTextContent("Not enough context to answer");
    expect(screen.getByTestId("playground-answer").querySelector("p.text-base")).toBeNull();
  });

  it("shows only one persistent run state while a previous result is still visible", () => {
    const state = pipeline.value as { experimentStatus: string };
    state.experimentStatus = "processing";
    renderRetrieval();

    expect(screen.getAllByTestId("playground-run-state")).toHaveLength(1);
    expect(screen.getByTestId("playground-run-state")).toHaveTextContent("Running experiment");
  });

  it("keeps backend error details behind a plain-language primary state", () => {
    const state = pipeline.value as { experimentRun: ExperimentRun | null; experimentError: { code: string; message: string } | null };
    state.experimentRun = null;
    state.experimentError = { code: "MODAL_TIMEOUT", message: "worker diagnostic detail" };
    renderRetrieval();

    const error = screen.getByTestId("playground-error");
    expect(error.querySelector("h2")).toHaveTextContent("Experiment couldn’t be completed");
    expect(error.querySelector("p")).toHaveTextContent("We couldn’t complete this experiment.");
    expect(error.querySelector("p")).not.toHaveTextContent("MODAL_TIMEOUT");
    expect(error.querySelector("p")).not.toHaveTextContent("worker diagnostic detail");
  });
});
