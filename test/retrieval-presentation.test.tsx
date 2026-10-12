import { act, cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pipeline = vi.hoisted(() => ({ value: null as unknown }));
const preview = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/components/document-pipeline-provider", () => ({
  useDocumentPipeline: () => pipeline.value,
}));
vi.mock("@/lib/rag-api", () => ({ getDocumentSourcePreviewUrl: preview.get }));

import { PreferencesProvider } from "@/components/preferences-provider";
import { RetrievalScreen } from "@/components/retrieval-screen";
import type { ExperimentRun, RetrievedCandidate, ValidatedCitation } from "@/lib/rag-api-types";

type Generation = NonNullable<ExperimentRun["stageResults"]["generation"]>;

function candidate(chunkId: string, rank: number, overrides: Partial<RetrievedCandidate> = {}): RetrievedCandidate {
  return { chunkId, rank, score: 0.8234, denseScore: 0.62, denseRank: rank, keywordScore: 0.1, keywordRank: rank, rrfScore: null, fusionScore: 0.8234, text: `Chunk ${chunkId} text`, documentId: "document-1", pageNumbers: [rank + 2], sourceElementIds: [`element-${chunkId}`], headingPath: [], ...overrides };
}

function citation(citationId: string, chunkId: string, valid = true): ValidatedCitation {
  return { citationId, documentId: "document-1", chunkId, pageNumbers: [3], quote: null, valid, sourceElementIds: [`element-${chunkId}`] };
}

function buildRun(generation: Partial<Generation> & { answer: string; insufficientContext: boolean }, overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    id: "experiment-1",
    runNumber: 4,
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
      generation: { citations: [], model: "gemini-generation-v1", inputTokens: null, outputTokens: null, durationMs: 10, ...generation },
    },
    ...overrides,
  };
}

const run = (id: string, upstream: Record<string, string> = {}) => ({ id, status: "completed", isCompatible: true, upstream });

function renderRetrieval() {
  return render(<PreferencesProvider><RetrievalScreen /></PreferencesProvider>);
}

function state() {
  return pipeline.value as { experimentRun: ExperimentRun | null; experimentStatus: string; experimentError: { code: string; message: string } | null; runExperiment: ReturnType<typeof vi.fn> };
}

function openAnswer() {
  fireEvent.click(within(screen.getByTestId("experiment-stage-trace")).getByRole("button", { name: /^Answer/ }));
}

beforeEach(() => {
  preview.get.mockRejectedValue(new Error("not needed"));
  pipeline.value = {
    activeDocument: { id: "document-1", parseRuns: [run("parse-1")], chunkRuns: [run("chunk-1", { parseRunId: "parse-1" })], embeddingRuns: [run("embedding-1", { chunkRunId: "chunk-1" })] },
    activePipeline: null,
    selectedParseResult: null,
    persistenceStatus: "available",
    workspaceStatus: "ready",
    selectedParseRunId: "parse-1",
    selectedChunkRunId: "chunk-1",
    selectedEmbeddingRunId: "embedding-1",
    experimentStatus: "completed",
    experimentError: null,
    experimentHistory: [],
    experimentRun: buildRun({ answer: "", insufficientContext: true }),
    runExperiment: vi.fn(),
    loadExperiment: vi.fn(),
    resumeRunTracking: vi.fn(),
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
  it("restores saved settings once and flags only a real draft difference", () => {
    const view = renderRetrieval();
    const question = screen.getByRole("textbox", { name: "Question" });
    expect(question).toHaveValue("What is the laboratory beacon code?");
    // Matching settings need no band (no "Unsaved changes" mental model).
    expect(screen.queryByTestId("playground-run-state")).not.toBeInTheDocument();
    fireEvent.change(question, { target: { value: "My draft" } });
    state().experimentRun = { ...state().experimentRun! };
    view.rerender(<PreferencesProvider><RetrievalScreen /></PreferencesProvider>);
    expect(question).toHaveValue("My draft");
    expect(screen.getByTestId("playground-run-state")).toHaveTextContent("Settings changed since this run.");
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("runs the experiment with Ctrl+Enter and Cmd+Enter", () => {
    renderRetrieval();
    const question = screen.getByRole("textbox", { name: "Question" });
    fireEvent.keyDown(question, { key: "Enter" });
    expect(state().runExperiment).not.toHaveBeenCalled();
    fireEvent.keyDown(question, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(question, { key: "Enter", metaKey: true });
    expect(state().runExperiment).toHaveBeenCalledTimes(2);
    expect(state().runExperiment).toHaveBeenCalledWith(expect.objectContaining({ query: "What is the laboratory beacon code?", targetStage: "generation" }));
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

  it("shows a simple insufficient-context state instead of a blank answer", () => {
    renderRetrieval();
    openAnswer();
    expect(screen.getByTestId("playground-insufficient-context")).toHaveTextContent("Not enough context to answer");
    expect(within(screen.getByTestId("playground-answer")).queryByTestId("playground-answer-text")).toBeNull();
    expect(screen.queryByTestId("playground-continue-evaluation")).not.toBeInTheDocument();
  });

  it("explains a grounding rejection with the rejected value, not as missing context", () => {
    state().experimentRun = buildRun({ answer: "", insufficientContext: false, outcome: "grounding_rejected", segments: [], groundingFailureDetail: { code: "unsupported_factual_token", token: "2027", attempts: 2 } });
    renderRetrieval();
    openAnswer();
    const rejected = screen.getByTestId("playground-grounding-rejected");
    expect(rejected).toHaveTextContent("Answer withheld: 2027 could not be verified");
    expect(rejected).toHaveTextContent("The value does not appear in the cited sources.");
    expect(screen.queryByTestId("playground-insufficient-context")).not.toBeInTheDocument();
    expect(screen.getByTestId("playground-details")).toHaveTextContent("Answer withheld (unverified value)");
  });

  it("renders answer segments as one paragraph with inline citation chips and titled citation rows", async () => {
    const user = userEvent.setup();
    const answered = buildRun({
      answer: "The beacon code is ORBIT-731.\n\nIt is on page three.",
      insufficientContext: false,
      outcome: "answered",
      segments: [{ text: "The beacon code is ORBIT-731.", citationIds: ["C1"] }, { text: "It is on page three.", citationIds: ["C1", "C2"] }],
      citations: [citation("C1", "chunk-a"), citation("C2", "chunk-b", false)],
      reuse: { reused: false, executed: true, sourceExperimentId: null, sourceDurationMs: null },
    });
    answered.stageResults.retrieval = { candidates: [candidate("chunk-a", 1, { headingPath: ["Safety", "Beacons"] }), candidate("chunk-b", 2, { text: "Second chunk first line\nmore" })], durationMs: 1 };
    state().experimentRun = answered;
    renderRetrieval();
    openAnswer();

    const paragraph = within(screen.getByTestId("playground-answer")).getByTestId("playground-answer-text");
    expect(paragraph.tagName).toBe("P");
    expect(paragraph).toHaveTextContent("The beacon code is ORBIT-731.[C1] It is on page three.[C1][C2]");
    expect(within(paragraph as HTMLElement).getAllByRole("button", { name: "Inspect source: C1" })).toHaveLength(2);
    // Default states stay quiet: no "Complete" pill and no "Executed" label.
    expect(screen.queryByText("Complete")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stage-reuse-generation")).not.toBeInTheDocument();

    const citations = screen.getByTestId("playground-citations");
    expect(citations).toHaveTextContent("A citation confirms the source is in the context, not that it supports the claim.");
    const rows = within(citations).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("[C1]Safety › Beaconsp. 3Citation valid");
    expect(rows[1]).toHaveTextContent("Second chunk first line");
    expect(within(rows[1]).getByTitle("Check citation")).toBeInTheDocument();
    expect(screen.getByTestId("playground-continue-evaluation")).toHaveAttribute("href", "/evaluation");
    expect(screen.getByRole("button", { name: "Regenerate answer" })).toBeEnabled();

    await user.click(within(rows[0]).getByRole("button", { name: "Inspect source: C1" }));
    expect(await screen.findByRole("dialog", { name: "Source inspector" })).toBeInTheDocument();
  });

  it("labels retrieval scores by their semantics and lists the top-K results, not the whole pool", () => {
    const pooled = buildRun({ answer: "", insufficientContext: true });
    pooled.stageResults.retrieval = {
      candidates: [candidate("chunk-a", 1), candidate("chunk-b", 2), candidate("chunk-c", 3)],
      results: [candidate("chunk-a", 1)],
      scoreSemantics: "relative_min_max_fusion_within_candidate_pool",
      durationMs: 3,
    };
    state().experimentRun = pooled;
    const view = renderRetrieval();
    const content = screen.getByTestId("playground-stage-content");
    expect(within(content).getAllByTestId("candidate-score")).toHaveLength(1);
    const score = within(content).getByTestId("candidate-score");
    expect(score).toHaveTextContent("Fusion score (relative, diagnostic) 0.82");
    expect(score).toHaveAttribute("title", "Ranking score; not an indicator of correctness.");
    // The score's meaning is shown once for the list, with the "not proof of correctness" hint behind (?).
    expect(within(content).getByTestId("playground-score-legend")).toHaveTextContent("Fusion score (relative, diagnostic)");
    expect(within(content).getByRole("button", { name: "About scores" })).toBeInTheDocument();
    expect(within(content).queryByTestId("playground-reranker-input")).not.toBeInTheDocument();
    expect(content).not.toHaveTextContent(/\d+ candidates/);
    expect(within(content).getByRole("button", { name: "Inspect source: Source document" })).toBeInTheDocument();

    // Without declared semantics the label follows the retrieval mode.
    const dense = buildRun({ answer: "", insufficientContext: true }, { id: "experiment-2", config: { retrieval: { mode: "dense", topK: 5 }, reranking: { enabled: false } } });
    dense.stageResults.retrieval = { candidates: [candidate("chunk-a", 1)], durationMs: 1 };
    state().experimentRun = dense;
    view.rerender(<PreferencesProvider><RetrievalScreen /></PreferencesProvider>);
    expect(screen.getByTestId("candidate-score")).toHaveTextContent("Cosine similarity 0.82");
  });

  it("explains context decisions with localized reasons and correct token plurals", () => {
    const withContext = buildRun({ answer: "", insufficientContext: true });
    withContext.stageResults.context = {
      candidates: [
        { chunkId: "chunk-a", selected: true, reason: "", tokenCount: 1, text: "Selected chunk", pageNumbers: [1], sourceElementIds: [] },
        { chunkId: "chunk-b", selected: false, reason: "budget_exceeded", tokenCount: 11, text: "Excluded chunk", pageNumbers: [2], sourceElementIds: [] },
      ],
      finalContext: "[C1] Selected chunk",
      tokenBudget: 3000,
      tokenCount: 1,
      durationMs: 1,
    };
    state().experimentRun = withContext;
    renderRetrieval();
    fireEvent.click(within(screen.getByTestId("experiment-stage-trace")).getByRole("button", { name: /^Context/ }));
    const items = within(screen.getByRole("list", { name: "Build context" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Selected1 token");
    expect(items[1]).toHaveTextContent("Excluded · Over the token budget11 tokens");
    expect(within(screen.getByTestId("playground-stage-content")).getByText("1 / 3,000 tokens")).toBeInTheDocument();
  });

  it("shows a queue/startup row only when the backend reports it", () => {
    state().experimentRun = buildRun({ answer: "", insufficientContext: true }, { queueDurationMs: 9_500 });
    const view = renderRetrieval();
    expect(screen.getByTestId("experiment-stage-queue")).toHaveTextContent("Queue / startup9.5 s");
    state().experimentRun = buildRun({ answer: "", insufficientContext: true }, { id: "experiment-3", queueDurationMs: null });
    view.rerender(<PreferencesProvider><RetrievalScreen /></PreferencesProvider>);
    expect(screen.queryByTestId("experiment-stage-queue")).not.toBeInTheDocument();
  });

  it("shows only one persistent run state while a previous result is still visible", () => {
    state().experimentStatus = "processing";
    renderRetrieval();

    expect(screen.getAllByTestId("playground-run-state")).toHaveLength(1);
    expect(screen.getByTestId("playground-run-state")).toHaveTextContent("Running experiment");
  });

  it("keeps backend error details behind a plain-language primary state", () => {
    state().experimentRun = null;
    state().experimentError = { code: "MODAL_TIMEOUT", message: "worker diagnostic detail" };
    renderRetrieval();

    const error = screen.getByTestId("playground-error");
    expect(error.querySelector("h2")).toHaveTextContent("Experiment couldn’t be completed");
    expect(error.querySelector("p")).toHaveTextContent("Try again, or review the technical details.");
    expect(error.querySelector("p")).not.toHaveTextContent("MODAL_TIMEOUT");
    expect(error.querySelector("p")).not.toHaveTextContent("worker diagnostic detail");
  });

  it("uses the Turkish glossary for stages, history and citations", () => {
    const answered = buildRun({ answer: "Kod ORBIT-731.", insufficientContext: false, outcome: "answered", segments: [{ text: "Kod ORBIT-731.", citationIds: ["C1"] }], citations: [citation("C1", "chunk-a")] });
    state().experimentRun = answered;
    (pipeline.value as { experimentHistory: ExperimentRun[] }).experimentHistory = [answered];
    // Outside the app shell the preferences fallback is Turkish.
    render(<RetrievalScreen />);
    fireEvent.click(within(screen.getByTestId("experiment-stage-trace")).getByRole("button", { name: /^Cevap/ }));

    expect(screen.getByRole("heading", { name: "Aşamalar" })).toBeInTheDocument();
    expect(screen.getByTestId("playground-result-meta")).toHaveTextContent("Deney #4");
    expect(screen.getByRole("heading", { name: "Atıflar" })).toBeInTheDocument();
    expect(screen.getByTestId("playground-citations")).toHaveTextContent("Atıf, kaynağın context'te olduğunu doğrular; iddiayı desteklediğini değil.");
    expect(screen.getByText("Çalıştırma geçmişi")).toBeInTheDocument();
    expect(screen.getByTestId("playground-history")).toHaveTextContent("Hybrid · Top 5");
    expect(screen.getByRole("button", { name: "Cevabı yeniden üret" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Değerlendirmeye devam et/ })).toHaveAttribute("href", "/evaluation");
    expect(screen.queryByText(/STAGE TRACE|Run history|Citations/)).not.toBeInTheDocument();
  });
});
