import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pipeline = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@/components/document-pipeline-provider", () => ({
  useDocumentPipeline: () => pipeline.value,
}));

import { EvaluationScreen } from "@/components/evaluation-screen";
import { PreferencesProvider } from "@/components/preferences-provider";

function parseResult(parseRunId: string, heading: string) {
  const element = { id: "element-1", type: "heading", pageNumbers: [1], text: heading, level: 1, table: null };
  return {
    document: { fileName: "lesson.pdf", mediaType: "application/pdf", sizeBytes: 9, pageCount: 1 },
    structured: { pages: [{ pageNumber: 1, elements: [element] }], elements: [element] },
    markdown: `# ${heading}`,
    summary: { pageCount: 1, headingCount: 1, paragraphCount: 0, listCount: 0, tableCount: 0 },
    documentId: "document-1",
    parseRunId,
    status: "completed",
    runMetadata: null,
    reusedDocument: false,
  };
}

function value(overrides: Record<string, unknown> = {}) {
  const noop = () => Promise.resolve(null);
  return {
    activeDocumentId: "document-1",
    activePipelineId: "pipeline-1",
    activeDocument: { id: "document-1", fileName: "lesson.pdf", parseRuns: [], chunkRuns: [], embeddingRuns: [], experiments: [], evaluationDatasets: [], evaluationRuns: [] },
    activePipeline: { id: "pipeline-1", name: "Pipeline", documentId: "document-1", parseRunId: "parse-current", chunkRunId: "chunk-1", embeddingRunId: "embedding-1", revision: 1 },
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

function renderEvaluation() {
  return render(<PreferencesProvider><EvaluationScreen /></PreferencesProvider>);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Evaluation lineage", () => {
  it("builds golden sources from the selected parse, never from an inspected historical parse", () => {
    pipeline.value = value();
    renderEvaluation();

    const picker = screen.getByTestId("source-picker-relevant-elements");
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

  it("names a missing dataset name instead of a generic configuration error", () => {
    pipeline.value = value();
    renderEvaluation();

    expect(screen.queryByText("Check the configuration values and try again.")).not.toBeInTheDocument();
    expect(screen.getByText("Enter a dataset name.")).toBeInTheDocument();
  });
});
