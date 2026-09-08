import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pipeline = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@/components/document-pipeline-provider", () => ({
  useDocumentPipeline: () => pipeline.value,
}));

import { ChunkingScreen, EmbeddingsScreen } from "@/components/pipeline-stage-screens";
import { ParseScreen } from "@/components/parse-screen";
import { OverviewScreen } from "@/components/overview-screen";
import { PreferencesProvider } from "@/components/preferences-provider";

const documentItem = {
  id: "document-1",
  fileName: "annual-report.pdf",
  mediaType: "application/pdf",
  sizeBytes: 128,
  pageCount: 12,
  sha256: "sha-1",
  activeParseRunId: "parse-1",
  activeChunkRunId: "chunk-1",
  activeEmbeddingRunId: "embedding-1",
  createdAt: null,
  updatedAt: null,
};

const timing = { startedAt: null, completedAt: null, durationMs: null };

const parseRun = {
  id: "parse-1",
  runNumber: 1,
  status: "completed",
  progress: 100,
  isStale: false,
  isCompatible: true,
  compatibilityReason: null,
  historicalLineage: false,
  upstream: { documentId: "document-1" },
  config: {},
  timing,
  error: null,
};

const chunkRun = {
  id: "chunk-1",
  runNumber: 1,
  status: "completed",
  progress: 100,
  isStale: false,
  isCompatible: true,
  compatibilityReason: null,
  historicalLineage: false,
  upstream: { documentId: "document-1", parseRunId: "parse-1" },
  config: { chunkSizeTokens: 512, overlapTokens: 64 },
  timing,
  error: null,
  strategy: "structure_aware",
  chunkCount: 12,
  chunks: [],
};

const embeddingRun = {
  id: "embedding-1",
  runNumber: 1,
  status: "completed",
  progress: 100,
  isStale: false,
  isCompatible: true,
  compatibilityReason: null,
  historicalLineage: false,
  upstream: { documentId: "document-1", chunkRunId: "chunk-1" },
  config: {},
  timing,
  error: null,
  model: "gemini",
  dimensions: 768,
  embeddingFormatVersion: "v1",
  embeddingCount: 12,
  effectiveModel: "gemini",
};

const activeDocument = {
  ...documentItem,
  parseRuns: [parseRun],
  chunkRuns: [chunkRun],
  embeddingRuns: [embeddingRun],
  experiments: [],
  evaluationDatasets: [],
  evaluationRuns: [],
};

const savedPipeline = {
  id: "pipeline-1",
  documentId: "document-1",
  name: "Structure Aware",
  parseRunId: "parse-1",
  chunkRunId: "chunk-1",
  embeddingRunId: "embedding-1",
  revision: 1,
  isDefault: true,
  createdAt: null,
  updatedAt: null,
};

function asyncNoop() {
  return Promise.resolve(null);
}

function createPipelineValue() {
  return {
    pendingUpload: null,
    fileError: null,
    parseStatus: "completed",
    parseProgress: 100,
    parseProgressEstimated: false,
    parsePhase: "completed",
    parseResult: null,
    parseError: null,
    activity: [],
    persistenceStatus: "available",
    persistenceError: null,
    capabilities: { embeddingModel: "gemini", embeddingDimensions: 768, generationModel: "gemini", rerankModel: "gemini", judgeModel: "gemini", embeddingFormatVersion: "v1", limits: {} },
    documents: [documentItem],
    activeDocumentId: documentItem.id,
    activeDocumentMetadata: documentItem,
    activeDocument,
    selectedParseRunId: parseRun.id,
    selectedChunkRunId: chunkRun.id,
    selectedEmbeddingRunId: embeddingRun.id,
    inspectedParseRunId: null,
    inspectedChunkRunId: null,
    inspectedEmbeddingRunId: null,
    chunkStatus: "completed",
    chunkRun,
    chunkError: null,
    embeddingStatus: "completed",
    embeddingRun,
    embeddingError: null,
    experimentStatus: "ready",
    experimentRun: null,
    experimentError: null,
    experimentHistory: [],
    evaluationDatasets: [],
    evaluationStatus: "ready",
    evaluationRun: null,
    evaluationError: null,
    evaluationHistory: [],
    uploadNotice: null,
    pipelines: [savedPipeline],
    activePipelineId: savedPipeline.id,
    activePipeline: savedPipeline,
    pipelineSelectionMode: "saved",
    selectFile: vi.fn(),
    addDocument: vi.fn(asyncNoop),
    selectPersistedDocument: vi.fn(asyncNoop),
    selectParseRun: vi.fn(asyncNoop),
    selectChunkRun: vi.fn(asyncNoop),
    selectEmbeddingRun: vi.fn(asyncNoop),
    inspectParseRun: vi.fn(asyncNoop),
    inspectChunkRun: vi.fn(asyncNoop),
    inspectEmbeddingRun: vi.fn(asyncNoop),
    setPipelineParseRun: vi.fn(asyncNoop),
    setPipelineChunkRun: vi.fn(asyncNoop),
    setPipelineEmbeddingRun: vi.fn(asyncNoop),
    selectPipeline: vi.fn(asyncNoop),
    createPipeline: vi.fn(asyncNoop),
    renamePipeline: vi.fn(asyncNoop),
    deletePipeline: vi.fn(asyncNoop),
    removeFile: vi.fn(),
    parseSelectedFile: vi.fn(asyncNoop),
    reparseActiveDocument: vi.fn(asyncNoop),
    parseActiveDocument: vi.fn(asyncNoop),
    runChunking: vi.fn(asyncNoop),
    runEmbedding: vi.fn(asyncNoop),
    runExperiment: vi.fn(asyncNoop),
    loadExperiment: vi.fn(asyncNoop),
    loadEvaluationDataset: vi.fn(asyncNoop),
    loadEvaluationRun: vi.fn(asyncNoop),
    continueExperiment: vi.fn(asyncNoop),
    rerunGeneration: vi.fn(asyncNoop),
    createDataset: vi.fn(asyncNoop),
    runEvaluation: vi.fn(asyncNoop),
    refreshPersistence: vi.fn(asyncNoop),
    refreshEvaluationRuns: vi.fn(asyncNoop),
  };
}

function renderScreen(node: React.ReactNode) {
  return render(<PreferencesProvider>{node}</PreferencesProvider>);
}

describe("Product workspace and build-stage semantic contract", () => {
  it("distinguishes checking from unavailable and avoids duplicate blocker copy", () => {
    pipeline.value = { ...createPipelineValue(), persistenceStatus: "checking" };
    const view = renderScreen(<ParseScreen />);
    expect(screen.getByText("Checking document service…")).toBeVisible();
    expect(screen.queryByText("The document service is unavailable.")).not.toBeInTheDocument();
    pipeline.value = { ...createPipelineValue(), persistenceStatus: "unavailable" };
    view.rerender(<PreferencesProvider><ParseScreen /></PreferencesProvider>);
    expect(screen.getAllByText("The document service is unavailable.")).toHaveLength(1);
  });

  it("moves the strategy selection with arrow keys and keeps one tab stop", () => {
    pipeline.value = createPipelineValue();
    renderScreen(<ChunkingScreen />);
    const radios = screen.getAllByRole("radio");
    const selected = radios.find((radio) => radio.getAttribute("aria-checked") === "true")!;
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    const next = radios[(radios.indexOf(selected) + 1) % radios.length];
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute("aria-checked", "true");
    expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
  });
  beforeEach(() => {
    pipeline.value = createPipelineValue();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps document and pipeline management available in the compact Overview disclosure", () => {
    renderScreen(<OverviewScreen />);

    expect(screen.getByTestId("workspace-control-plane")).toBeVisible();
    expect(screen.getByRole("combobox", { name: /^Document/ })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Indexing pipeline" })).toBeVisible();
    expect(screen.queryByTestId("overview-lineage")).not.toBeInTheDocument();
    expect(screen.getByTestId("continue-surface")).toBeVisible();
    expect(screen.getByTestId("overview-continue-action")).toHaveAttribute("href", "/playground");
    expect(screen.getByTestId("overview-continue-action")).toHaveTextContent("Continue to Playground");
    const management = screen.getByTestId("pipeline-management");
    expect(management).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("Manage pipeline"));

    expect(management).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "New pipeline" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Rename" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete" })).toBeVisible();
  });

  it("keeps the active document and pipeline context visible on Parsing", () => {
    renderScreen(<ParseScreen />);

    const context = screen.getByTestId("pipeline-context-bar");
    expect(context).toBeVisible();
    expect(context).not.toHaveClass("sr-only");
    expect(screen.getByTestId("pipeline-context-document-selector")).toHaveTextContent("annual-report.pdf");
    expect(screen.getByTestId("pipeline-context-pipeline-selector")).toHaveTextContent("Structure Aware");
    expect(screen.getByTestId("parse-workspace-controls")).toContainElement(screen.getByTestId("parse-document-status"));
    expect(screen.getByTestId("parse-document-status")).toHaveTextContent("Parse Completed");
    expect(screen.getByTestId("parse-reports-action")).toBeDisabled();
    expect(screen.queryByRole("navigation", { name: "Indexing lineage" })).not.toBeInTheDocument();
    expect(screen.getByTestId("parse-page-header")).toContainElement(screen.getByTestId("parse-next-action"));
    expect(screen.getByTestId("parse-next-action")).toBeDisabled();
    expect(screen.getByText("Complete parsing before continuing to Chunking.", { exact: true })).toBeInTheDocument();
  });

  it("shows the active document on Embeddings with one dominant Playground CTA", () => {
    renderScreen(<EmbeddingsScreen />);

    expect(screen.getByTestId("pipeline-context-bar")).toHaveTextContent("annual-report.pdf");
    expect(screen.getByTestId("pipeline-context-pipeline-selector")).toHaveTextContent("Structure Aware");
    expect(screen.queryByTestId("embedding-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("embedding-primary-result")).toHaveTextContent("12 chunks");
    expect(screen.getByTestId("embedding-primary-result")).toHaveTextContent("Selected chunk set");
    expect(screen.getByTestId("embedding-output-result")).toHaveTextContent("12 embeddings");
    expect(screen.getByTestId("embedding-result-details")).toHaveTextContent("gemini");
    expect(screen.getByTestId("embedding-details")).not.toHaveAttribute("open");
    expect(screen.getByTestId("embedding-details")).toHaveTextContent("Stored in pgvector");
    expect(screen.getAllByRole("link", { name: /Go to Playground/ })).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: /Go to Playground/ })).toHaveLength(0);
    expect(screen.getByTestId("embeddings-page-header")).toContainElement(screen.getByTestId("embeddings-next-action"));
    expect(screen.getByTestId("embeddings-page-header")).not.toContainElement(screen.getByTestId("embedding-run-action"));
    expect(screen.getByTestId("embedding-run-action")).toBeVisible();
  });

  it("keeps a locked next action in the header with its remediation", () => {
    pipeline.value = {
      ...createPipelineValue(),
      activeDocument: { ...activeDocument, activeEmbeddingRunId: null, embeddingRuns: [] },
      activePipeline: { ...savedPipeline, embeddingRunId: null },
      embeddingRun: null,
      pipelines: [{ ...savedPipeline, embeddingRunId: null }],
      selectedEmbeddingRunId: null,
    };
    renderScreen(<EmbeddingsScreen />);

    const nextAction = screen.getByTestId("embeddings-next-action");
    expect(screen.getByTestId("embeddings-page-header")).toContainElement(nextAction);
    expect(nextAction).toBeDisabled();
    expect(nextAction).toHaveAttribute("aria-describedby", "embeddings-next-action-disabled-reason");
    expect(screen.getByText("Create embeddings before continuing to Playground.", { exact: true })).toBeInTheDocument();
  });

  it("uses the same header next-action slot on Chunking", () => {
    renderScreen(<ChunkingScreen />);

    expect(screen.getByTestId("chunking-page-header")).toContainElement(screen.getByTestId("chunking-next-action"));
    expect(screen.getByTestId("chunking-next-action")).toHaveAttribute("href", "/embeddings");
    expect(screen.getAllByRole("link", { name: /Go to Embeddings/ })).toHaveLength(1);
    expect(screen.getByTestId("chunking-workspace")).toContainElement(screen.getByTestId("chunking-run-action"));
    expect(screen.getByTestId("chunking-config-card")).toContainElement(screen.getByTestId("chunk-compact-controls"));
    expect(screen.getByTestId("chunking-config-card")).toContainElement(screen.getByTestId("chunking-run-action"));
  });

  it("keeps the pipeline placeholder out of selectable domain items", () => {
    pipeline.value = { ...createPipelineValue(), activePipelineId: null, activePipeline: null };
    renderScreen(<OverviewScreen />);

    const selector = screen.getByRole("combobox", { name: "Indexing pipeline" });
    expect(selector).toHaveTextContent("Select a pipeline");
    fireEvent.click(selector);
    expect(screen.queryByRole("option", { name: "Select a pipeline" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("clear-pipeline-selection")).not.toBeInTheDocument();
  });
});
