import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const pipeline = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));

vi.mock("@/components/document-pipeline-provider", () => ({
  useDocumentPipeline: () => pipeline.value,
}));
vi.mock("@/components/ui/toast", () => ({ toast: toastMock }));
vi.mock("@/lib/rag-api", () => ({ getDocumentSourcePreviewUrl: vi.fn().mockRejectedValue(new Error("not needed")) }));

import { EvaluationScreen } from "@/components/evaluation-screen";
import { PreferencesProvider } from "@/components/preferences-provider";
import type { ParsedElement } from "@/lib/document-parse-types";
import type { EvaluationCaseResult, EvaluationRun } from "@/lib/rag-api-types";

function parseResult(parseRunId: string, heading: string, extra: ParsedElement[] = []) {
  const elements: ParsedElement[] = [{ id: "element-1", type: "heading", pageNumbers: [1], text: heading, level: 1, table: null }, ...extra];
  const pages = Array.from(new Set(elements.flatMap((element) => element.pageNumbers))).map((pageNumber) => ({ pageNumber, elements: elements.filter((element) => element.pageNumbers[0] === pageNumber) }));
  return {
    document: { fileName: "lesson.pdf", mediaType: "application/pdf", sizeBytes: 9, pageCount: 1 },
    structured: { pages, elements },
    markdown: `# ${heading}`,
    summary: { pageCount: 1, headingCount: 1, paragraphCount: 0, listCount: 0, tableCount: 0 },
    documentId: "document-1",
    parseRunId,
    status: "completed",
    runMetadata: null,
    reusedDocument: false,
  };
}

const runSummary = (id: string, upstream: Record<string, string> = {}) => ({ id, status: "completed", isCompatible: true, upstream });
const dataset = { id: "dataset-1", documentId: "document-1", parseRunId: "parse-current", name: "Golden set", version: 2, caseCount: 2, createdAt: null };

function value(overrides: Record<string, unknown> = {}) {
  const noop = () => Promise.resolve(null);
  return {
    activeDocumentId: "document-1",
    activePipelineId: "pipeline-1",
    activeDocument: { id: "document-1", fileName: "lesson.pdf", parseRuns: [runSummary("parse-current")], chunkRuns: [runSummary("chunk-1", { parseRunId: "parse-current" })], embeddingRuns: [runSummary("embedding-1", { chunkRunId: "chunk-1" })], experiments: [], evaluationDatasets: [], evaluationRuns: [] },
    activePipeline: { id: "pipeline-1", name: "Pipeline", documentId: "document-1", parseRunId: "parse-current", chunkRunId: "chunk-1", embeddingRunId: "embedding-1", revision: 1 },
    persistenceStatus: "available",
    workspaceStatus: "ready",
    selectedParseRunId: "parse-current",
    selectedChunkRunId: "chunk-1",
    selectedEmbeddingRunId: "embedding-1",
    // An inspected historical parse is the inspect-screen artifact; Evaluation must ignore it.
    parseResult: parseResult("parse-historical", "Historical heading"),
    selectedParseResult: parseResult("parse-current", "Current heading"),
    capabilities: null,
    evaluationDatasets: [],
    evaluationStatus: "ready",
    evaluationRun: null,
    evaluationError: null,
    evaluationHistory: [],
    resumeRunTracking: vi.fn(noop),
    createDataset: vi.fn(noop),
    loadEvaluationDataset: vi.fn(noop),
    runEvaluation: vi.fn(noop),
    refreshEvaluationRuns: vi.fn(noop),
    ...overrides,
  };
}

function caseResult(overrides: Partial<EvaluationCaseResult> = {}): EvaluationCaseResult {
  return { question: "What is the beacon code?", expectedElementIds: ["element-1"], retrievedElementIds: ["element-1"], referenceAnswer: null, answer: "ORBIT-731", citations: [], expectedOutcome: "answer", insufficientContext: false, abstentionCorrect: null, hitAtK: 1, precisionAtK: 1, recallAtK: 1, mrr: 1, citationValidity: 1, groundedness: 0.8, generationMetrics: { faithfulness: null, answerRelevance: null, answerCorrectness: null, eligibleCaseCount: null, scoredCaseCount: null, lexicalOverlap: 0.8, method: "citation_token_overlap_v1" }, experimentId: "experiment-1", status: "completed", generationOutcome: "answered", ...overrides };
}

function evaluationRun(id: string, overrides: Partial<EvaluationRun["results"]> = {}, config: Record<string, unknown> = {}, caseResults: EvaluationCaseResult[] = [caseResult()]): EvaluationRun {
  return {
    id,
    status: "completed",
    progress: null,
    isStale: false,
    isCompatible: true,
    compatibilityReason: null,
    historicalLineage: false,
    upstream: {},
    config: { pipelineId: "pipeline-1", embeddingRunId: "embedding-1", retrieval: { mode: "hybrid", topK: 5 }, reranking: { enabled: false, candidateCount: 10 }, judge: false, ...config },
    timing: { startedAt: "2026-10-01T00:00:00Z", completedAt: null, durationMs: 1200 },
    error: null,
    datasetId: "dataset-1",
    results: { hitAtK: 1, recallAtK: 0.5, precisionAtK: null, mrr: 1, citationValidity: 1, groundedness: 0.8, judgeModel: null, caseCount: 2, retrievalEligibleCaseCount: 1, abstentionEligibleCaseCount: 0, abstentionAccuracy: null, generationMetrics: { faithfulness: null, answerRelevance: null, answerCorrectness: null, eligibleCaseCount: 0, scoredCaseCount: 0, lexicalOverlap: 0.8, method: "citation_token_overlap_v1", lexicalScoredCaseCount: 1 }, ...overrides },
    caseResults,
  };
}

function renderEvaluation() {
  return render(<PreferencesProvider><EvaluationScreen /></PreferencesProvider>);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

describe("Evaluation lineage and dataset form", () => {
  it("builds golden sources from the selected parse, never from an inspected historical parse", () => {
    pipeline.value = value();
    renderEvaluation();

    const picker = screen.getByTestId("source-picker-relevant-elements");
    fireEvent.click(within(picker).getByRole("button", { name: /Choose sources/ }));
    expect(picker).toHaveTextContent("Current heading");
    expect(picker).not.toHaveTextContent("Historical heading");
  });

  it("resets local drafts when the document or lineage changes", () => {
    pipeline.value = value();
    const view = renderEvaluation();
    fireEvent.change(screen.getByLabelText("Dataset name"), { target: { value: "Golden set" } });
    expect(screen.getByLabelText("Dataset name")).toHaveValue("Golden set");

    pipeline.value = value({ activeDocumentId: "document-2", selectedParseRunId: "parse-other" });
    view.rerender(<PreferencesProvider><EvaluationScreen /></PreferencesProvider>);
    expect(screen.getByLabelText("Dataset name")).toHaveValue("");
  });

  it("keeps a pristine form quiet and names the missing field after input or a submit attempt", async () => {
    const user = userEvent.setup();
    pipeline.value = value();
    renderEvaluation();

    expect(screen.queryByText("Enter a dataset name.")).not.toBeInTheDocument();
    expect(screen.queryByText("Check the configuration values and try again.")).not.toBeInTheDocument();
    const create = screen.getByRole("button", { name: "Create dataset" });
    expect(create).toBeEnabled();

    await user.click(create);
    expect(screen.getByText("Enter a dataset name.")).toBeInTheDocument();
    expect(create).toHaveAccessibleDescription("Enter a dataset name.");
    expect((pipeline.value.createDataset as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Dataset name"), "Golden set");
    expect(screen.getByText("Enter the text of every question.")).toBeInTheDocument();
  });

  it("opens Results by default when a dataset exists and moves there after a dataset is created", async () => {
    const user = userEvent.setup();
    pipeline.value = value({ evaluationDatasets: [dataset] });
    const first = renderEvaluation();
    expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true");
    first.unmount();

    const createDataset = vi.fn(() => {
      pipeline.value = { ...pipeline.value, evaluationDatasets: [dataset] };
      return Promise.resolve();
    });
    pipeline.value = value({ createDataset });
    const view = renderEvaluation();
    expect(screen.getByRole("tab", { name: "Dataset" })).toHaveAttribute("aria-selected", "true");

    await user.type(screen.getByLabelText("Dataset name"), "Golden set");
    await user.type(screen.getByLabelText("Golden question"), "What is the heading?");
    await user.click(screen.getByRole("button", { name: /Choose sources/ }));
    await user.click(within(screen.getByRole("list", { name: "Parsed source elements" })).getByRole("button", { name: /Current heading/ }));
    await user.click(screen.getByRole("button", { name: "Create dataset" }));
    expect(createDataset).toHaveBeenCalledWith("Golden set", [expect.objectContaining({ question: "What is the heading?", relevantElementIds: ["element-1"] })], null);

    view.rerender(<PreferencesProvider><EvaluationScreen /></PreferencesProvider>);
    expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("evaluation-workspace-context")).toHaveTextContent("Golden set v2 · 2 questions");
  });

  it("implements the ARIA tabs keyboard model with a roving tab index", async () => {
    const user = userEvent.setup();
    pipeline.value = value();
    renderEvaluation();
    const datasetTab = screen.getByRole("tab", { name: "Dataset" });
    expect(screen.getByRole("tablist", { name: "Evaluation views" })).toBeInTheDocument();
    expect(datasetTab).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tab", { name: "Results" })).not.toHaveAttribute("aria-controls");

    datasetTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Results" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "evaluation-tab-results");
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Compare" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Dataset" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Compare" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Dataset" })).toHaveAttribute("aria-selected", "true");
  });

  it("makes a large source list searchable and filterable with readable table summaries", async () => {
    const user = userEvent.setup();
    const extra: ParsedElement[] = [
      { id: "element-2", type: "paragraph", pageNumbers: [1], text: "The laboratory beacon code is ORBIT-731.", level: null, table: null },
      { id: "element-3", type: "heading", pageNumbers: [2], text: "Appendix", level: 1, table: null },
      { id: "element-4", type: "table", pageNumbers: [2], text: "| Field | Value |\n| --- | --- |\n| Beacon | ORBIT-731 |", level: null, table: { rows: [["Field", "Value"], ["Beacon", "ORBIT-731"]], markdown: "" } },
    ];
    pipeline.value = value({ selectedParseResult: parseResult("parse-current", "Current heading", extra) });
    renderEvaluation();
    const picker = screen.getByTestId("source-picker-relevant-elements");
    await user.click(within(picker).getByRole("button", { name: /Choose sources/ }));
    const list = () => within(picker).getByRole("list", { name: "Parsed source elements" });
    expect(within(list()).getAllByRole("button")).toHaveLength(4);
    // Tables read as one line, not raw pipes.
    expect(list()).toHaveTextContent("Table · 2 rows · Field, Value");
    expect(list()).not.toHaveTextContent("| Field |");

    await user.type(within(picker).getByRole("searchbox", { name: "Search sources" }), "beacon");
    expect(within(list()).getAllByRole("button")).toHaveLength(2);
    expect(within(picker).getByText("2 of 4")).toBeInTheDocument();

    await user.clear(within(picker).getByRole("searchbox", { name: "Search sources" }));
    await user.click(within(picker).getByRole("combobox", { name: "Section" }));
    await user.click(screen.getByRole("option", { name: "Appendix" }));
    expect(within(list()).getAllByRole("button")).toHaveLength(2);
    await user.click(within(list()).getByRole("button", { name: /Table · 2 rows/ }));
    expect(within(list()).getByRole("button", { name: /Table · 2 rows/ })).toHaveAttribute("aria-pressed", "true");

    const chips = within(picker).getByRole("list", { name: "Source evidence" });
    expect(chips).toHaveTextContent("p. 2 · Table · 2 rows · Field, Value");
    await user.click(within(chips).getByRole("button", { name: /^Remove/ }));
    expect(within(picker).queryByRole("list", { name: "Source evidence" })).not.toBeInTheDocument();
  });
});

describe("Evaluation results and comparison", () => {
  it("shows two-decimal metrics, sample sizes, 'not measured' for null and the lexical diagnostic when the judge was off", async () => {
    const user = userEvent.setup();
    const failed = caseResult({ question: "Which value failed?", status: "failed", errorCode: "citation_invalid", errorMessage: "Unknown citation.", answer: null, generationMetrics: null, citationValidity: 0 });
    const unmeasured = caseResult({ question: "Unscored?", generationMetrics: { faithfulness: null, answerRelevance: null, answerCorrectness: null, eligibleCaseCount: null, scoredCaseCount: null, lexicalOverlap: null }, groundedness: null });
    const run = evaluationRun("evaluation-1", { failedCaseCount: 1, failedCaseCodes: [{ code: "citation_invalid", count: 1 }], completedCaseCount: 2, caseCount: 3 }, {}, [caseResult(), unmeasured, failed]);
    pipeline.value = value({ evaluationDatasets: [dataset], evaluationRun: run, evaluationHistory: [run] });
    renderEvaluation();

    const retrieval = screen.getByTestId("evaluation-retrieval-metrics");
    expect(retrieval).toHaveTextContent("Recall@K0.50");
    expect(retrieval).toHaveTextContent("Precision@K— not measured");
    expect(retrieval.closest("section")).toHaveTextContent("n = 1 question");
    const answer = screen.getByTestId("evaluation-answer-metrics");
    expect(answer).not.toHaveTextContent("Faithfulness");
    expect(answer).toHaveTextContent("Source word overlap (diagnostic)");
    expect(answer).toHaveTextContent("0.80");
    // Caveats sit behind the metric's (?) tooltip; the panel states once that scores are diagnostic.
    await user.hover(within(answer).getByRole("button", { name: "About Citation validity" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("A citation confirms the source is in the context, not that it supports the claim.");
    await user.unhover(within(answer).getByRole("button", { name: "About Citation validity" }));
    expect(screen.getByTestId("evaluation-diagnostic-note")).toHaveTextContent("Scores are diagnostic signals, not proof of correctness.");
    expect(screen.getByTestId("evaluation-run-summary")).toHaveTextContent("n = 3 questions");
    expect(screen.getByTestId("evaluation-run-summary")).toHaveTextContent("1 failed");

    expect(screen.getByTestId("evaluation-case-threshold")).toHaveTextContent("Diagnostic threshold: Source word overlap (diagnostic) ≥ 0.50 and citation validity ≥ 0.50.");
    const cases = screen.getAllByTestId("evaluation-case");
    expect(cases).toHaveLength(2);
    expect(cases[0]).toHaveAttribute("data-state", "ok");
    expect(cases[0]).toHaveTextContent("Word overlap 0.80 · Citation 1.00");
    expect(cases[1]).toHaveAttribute("data-state", "notMeasured");
    expect(within(cases[1]).getByTitle("Not measured")).toBeInTheDocument();
    const failedCases = screen.getByTestId("evaluation-failed-cases");
    expect(failedCases).toHaveTextContent("Which value failed?");
    // The cause in words once; the code appears only inside its Technical details.
    expect(within(failedCases).getByTestId("evaluation-failed-case-cause")).toHaveTextContent("The AI model returned an incomplete response. Try again.");
    const details = within(failedCases).getAllByTestId("api-error-details");
    expect(details).toHaveLength(1);
    expect(details[0]).toHaveTextContent("Code: citation_invalid");
    expect(failedCases.textContent?.match(/citation_invalid/g)).toHaveLength(1);

    await user.click(screen.getByRole("tab", { name: "Compare" }));
    // Fewer than two selected runs: the history is open so runs can be picked.
    expect(screen.getByTestId("evaluation-history")).toHaveAttribute("open");
  });

  it("does not show answer-metric deltas across different methods, and keeps deltas neutral", async () => {
    const user = userEvent.setup();
    const judged = evaluationRun("evaluation-b", { hitAtK: 0.5, generationMetrics: { faithfulness: 0.9, answerRelevance: 0.8, answerCorrectness: null, eligibleCaseCount: 0, scoredCaseCount: 1, lexicalOverlap: 0.7, method: "gemini_generation_metrics_v2" } }, { judge: true, retrieval: { mode: "dense", topK: 10 } });
    const lexical = evaluationRun("evaluation-a");
    pipeline.value = value({ evaluationDatasets: [dataset], evaluationHistory: [judged, lexical] });
    renderEvaluation();
    await user.click(screen.getByRole("tab", { name: "Compare" }));
    await user.click(screen.getByRole("checkbox", { name: "Compare Evaluation #1" }));
    await user.click(screen.getByRole("checkbox", { name: "Compare Evaluation #2" }));

    expect(screen.getByTestId("evaluation-method-mismatch")).toHaveTextContent("A: Word overlap, B: Judge model");
    const table = screen.getByRole("table", { name: "Metric comparison" });
    const row = (name: string) => within(table).getByRole("rowheader", { name: new RegExp(`^${name}`) }).closest("tr") as HTMLElement;
    expect(row("Faithfulness")).toHaveTextContent("Not comparable");
    expect(row("Source word overlap")).toHaveTextContent("−0.10");
    expect(row("Hit@K")).toHaveTextContent("−0.50");
    expect(row("Hit@K")).toHaveTextContent("lower");
    expect(table.querySelector(".text-success, .text-destructive, .bg-success-subtle, .bg-destructive-subtle")).toBeNull();
    expect(within(table).getAllByRole("rowheader", { name: "Retrieval quality" })).toHaveLength(1);

    const context = screen.getByTestId("evaluation-compare-context");
    expect(context).toHaveTextContent("Context compatibility");
    expect(context).toHaveTextContent("Settings differ");
    expect(within(context).getByRole("table", { name: "Changed settings" })).toHaveTextContent("Retrieval modeHybridDense");
    expect(context).not.toHaveTextContent("RUN A:");
  });

  it("shows a browser poll timeout as paused tracking with one Resume tracking action", async () => {
    const user = userEvent.setup();
    const running = { ...evaluationRun("evaluation-1"), status: "running" as const, caseResults: [] };
    pipeline.value = value({ evaluationDatasets: [dataset], evaluationStatus: "error", evaluationRun: running, evaluationHistory: [running], evaluationError: { code: "run_poll_timeout", message: "Browser tracking paused after 15 minutes." } });
    renderEvaluation();

    const paused = screen.getByTestId("evaluation-error");
    expect(paused).toHaveAttribute("data-tone", "warning");
    expect(paused).toHaveAttribute("data-error-kind", "tracking-paused");
    expect(paused).toHaveTextContent("The run may still be working");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Resume tracking" })).toHaveLength(1);
    await user.click(within(paused).getByRole("button", { name: "Resume tracking" }));
    expect(pipeline.value.resumeRunTracking).toHaveBeenCalledWith("evaluation");
  });

  it("keeps Resume tracking for an in-flight run without an error", () => {
    const running = { ...evaluationRun("evaluation-1"), status: "running" as const, caseResults: [] };
    pipeline.value = value({ evaluationDatasets: [dataset], evaluationStatus: "ready", evaluationRun: running, evaluationHistory: [running] });
    renderEvaluation();
    expect(screen.queryByTestId("evaluation-error")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume tracking" })).toBeInTheDocument();
  });

  it("announces a tracked run that stops with its localized cause", () => {
    const running = { ...evaluationRun("evaluation-1"), status: "running" as const, caseResults: [] };
    pipeline.value = value({ evaluationDatasets: [dataset], evaluationStatus: "processing", evaluationRun: running, evaluationHistory: [running] });
    const view = renderEvaluation();
    const failed = { ...evaluationRun("evaluation-1"), status: "failed" as const, error: { code: "evaluation_cases_failed", message: "All cases failed." } };
    pipeline.value = { ...pipeline.value, evaluationStatus: "error", evaluationRun: failed, evaluationHistory: [failed], evaluationError: failed.error };
    view.rerender(<PreferencesProvider><EvaluationScreen /></PreferencesProvider>);

    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(toastMock.error).toHaveBeenCalledWith("Evaluation #1 stopped", { description: "None of the questions could be evaluated. Try again shortly." });
  });

  it("shows a failed dataset create on the Dataset tab, and other evaluation errors only on Results", async () => {
    const user = userEvent.setup();
    const createDataset = vi.fn(() => {
      pipeline.value = { ...pipeline.value, evaluationStatus: "error", evaluationError: { code: "evaluation_dataset_too_large", message: "Too many cases." } };
      return Promise.resolve();
    });
    pipeline.value = value({ createDataset });
    const view = renderEvaluation();
    await user.type(screen.getByLabelText("Dataset name"), "Golden set");
    await user.type(screen.getByLabelText("Golden question"), "What is the heading?");
    await user.click(screen.getByRole("button", { name: /Choose sources/ }));
    await user.click(within(screen.getByRole("list", { name: "Parsed source elements" })).getByRole("button", { name: /Current heading/ }));
    await user.click(screen.getByRole("button", { name: "Create dataset" }));
    view.rerender(<PreferencesProvider><EvaluationScreen /></PreferencesProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("This dataset has too many questions.");

    // A history load failure is not the form's error.
    pipeline.value = { ...pipeline.value, evaluationError: { code: "unknown", message: "Evaluation history could not be loaded." } };
    view.rerender(<PreferencesProvider><EvaluationScreen /></PreferencesProvider>);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Results" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Evaluation history could not be loaded.");
  });

  it("names the evaluation progress bar", () => {
    pipeline.value = value({ evaluationDatasets: [dataset], evaluationStatus: "processing", evaluationRun: { ...evaluationRun("evaluation-1"), status: "running", caseResults: [] } });
    renderEvaluation();
    expect(screen.getByRole("progressbar", { name: "Question progress" })).toHaveAttribute("aria-valuemax", "2");
  });
});
