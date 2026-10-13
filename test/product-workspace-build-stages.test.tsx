import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pipeline = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@/components/document-pipeline-provider", () => ({
  useDocumentPipeline: () => pipeline.value,
}));

import { ChunkingScreen, EmbeddingsScreen } from "@/components/pipeline-stage-screens";
import { ParseScreen } from "@/components/parse-screen";
import { OverviewScreen } from "@/components/overview-screen";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
import { PreferencesProvider } from "@/components/preferences-provider";

type MockFn = ReturnType<typeof vi.fn>;
const call = (name: string) => pipeline.value[name] as MockFn;

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
    parseStatus: "completed",
    parseProgress: 100,
    parseProgressEstimated: false,
    parsePhase: "completed",
    parseResult: null,
    parseError: null,
    persistenceStatus: "available",
    workspaceStatus: "ready",
    persistenceError: null,
    capabilities: { embeddingModel: "gemini", embeddingDimensions: 768, generationModel: "gemini", rerankModel: "gemini", judgeModel: "gemini", embeddingFormatVersion: "v1", limits: {} },
    documents: [documentItem],
    activeDocumentId: documentItem.id,
    activeDocumentMetadata: documentItem,
    activeDocument,
    selectedParseRunId: parseRun.id,
    selectedChunkRunId: chunkRun.id,
    selectedEmbeddingRunId: embeddingRun.id,
    selectedParseResult: null,
    selectedChunkRun: chunkRun,
    selectedEmbeddingRun: embeddingRun,
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
    reparseImpact: { target: "pipeline", pipelineId: savedPipeline.id, pipelineName: savedPipeline.name, clearsChunk: true, clearsEmbedding: true, requiresConfirmation: true },
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
    reparseActiveDocument: vi.fn(asyncNoop),
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
    pipeline.value = { ...createPipelineValue(), persistenceStatus: "checking", workspaceStatus: "loading" };
    const view = renderScreen(<ParseScreen />);
    // Loading is neutral: the action waits, but no blocker or error is invented.
    expect(screen.getByTestId("parse-run-action")).toBeDisabled();
    expect(screen.queryByTestId("parse-blocker")).not.toBeInTheDocument();
    expect(screen.queryByText("The RAG service is temporarily unavailable. Retry shortly.")).not.toBeInTheDocument();
    pipeline.value = { ...createPipelineValue(), persistenceStatus: "unavailable", workspaceStatus: "unavailable" };
    view.rerender(<PreferencesProvider><ParseScreen /></PreferencesProvider>);
    // One visible copy; the blocked next step keeps the same sentence only as its sr-only description.
    const outage = "The RAG service is temporarily unavailable. Retry shortly.";
    expect(screen.getAllByText(outage).filter((element) => !element.classList.contains("sr-only"))).toHaveLength(1);
    expect(screen.getByTestId("parse-next-action")).toBeDisabled();
    expect(screen.getByTestId("parse-next-action")).toHaveAccessibleDescription(outage);
    expect(screen.getByTestId("parse-blocker")).toHaveAttribute("data-tone", "error");
  });

  it("moves the strategy selection with arrow keys and keeps one tab stop", () => {
    pipeline.value = createPipelineValue();
    renderScreen(<ChunkingScreen />);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    const selected = radios.find((radio) => radio.checked)!;
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    const next = radios[(radios.indexOf(selected) + 1) % radios.length];
    expect(next).toHaveFocus();
    expect(next).toBeChecked();
    expect(radios.filter((radio) => radio.tabIndex === 0)).toHaveLength(1);
  });
  it("starts the chunking form from the selected chunk run and reports whether it is up to date", () => {
    const recursiveRun = { ...chunkRun, strategy: "recursive_token", config: { chunkSizeTokens: 256, overlapTokens: 32 } };
    pipeline.value = {
      ...createPipelineValue(),
      activeDocument: { ...activeDocument, chunkRuns: [recursiveRun] },
      chunkRun: recursiveRun,
      selectedChunkRun: recursiveRun,
    };
    renderScreen(<ChunkingScreen />);

    expect(screen.getByRole("radio", { name: /Recursive/ })).toBeChecked();
    expect(screen.getByLabelText(/Chunk size/)).toHaveValue(256);
    expect(screen.getByLabelText(/Overlap/)).toHaveValue(32);
    const card = screen.getByTestId("chunking-config-card");
    expect(card).toHaveAttribute("data-chunk-up-to-date", "true");
    expect(card).toHaveAttribute("data-chunk-config-dirty", "false");

    fireEvent.change(screen.getByLabelText(/Chunk size/), { target: { value: "300" } });
    expect(card).toHaveAttribute("data-chunk-up-to-date", "false");
    expect(card).toHaveAttribute("data-chunk-config-dirty", "true");
  });

  it("keeps chunk heading and page metadata single-sourced in the inspector", () => {
    const detailedChunk = {
      id: "chunk-1-1",
      ordinal: 0,
      text: "A chunk with source metadata.",
      tokenCount: 120,
      pageNumbers: [1],
      headingPath: ["Introduction", "Overview"],
      sourceElementIds: ["element-1"],
    };
    const detailedRun = { ...chunkRun, chunks: [detailedChunk] };
    pipeline.value = {
      ...createPipelineValue(),
      activeDocument: { ...activeDocument, chunkRuns: [detailedRun] },
      chunkRun: detailedRun,
    };
    renderScreen(<ChunkingScreen />);
    const detail = within(screen.getByTestId("chunk-inspector-detail"));
    expect(detail.getAllByText("Introduction › Overview", { exact: true })).toHaveLength(1);
    expect(detail.getAllByText("p. 1", { exact: true })).toHaveLength(1);
    expect(detail.getByText("120 tokens")).toBeInTheDocument();
    expect(detail.getByText("1 element")).toBeInTheDocument();
    // Raw IDs stay available, but only inside Technical details.
    const technical = detail.getByTestId("chunk-technical-details");
    expect(technical).not.toHaveAttribute("open");
    expect(technical).toHaveTextContent("element-1");
    expect(technical).toHaveTextContent("chunk-1-1");
    // The list item does not repeat its own heading on the second line.
    const item = screen.getByTestId("chunk-list-item");
    expect(item.textContent?.match(/Overview/g)).toHaveLength(1);
    expect(item).toHaveTextContent("Introduction · p. 1");
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
    // One CTA, no extra "continue" heading or "Next step" line.
    expect(screen.getByTestId("continue-surface")).not.toHaveTextContent(/Next step|Continue where/);
    const management = screen.getByTestId("pipeline-management");
    expect(management).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("Manage pipeline"));

    expect(management).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "New pipeline" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Rename" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete" })).toBeVisible();
  });

  it("keeps the pipeline editor open when saving fails", async () => {
    pipeline.value = { ...createPipelineValue(), createPipeline: vi.fn(async () => null) };
    renderScreen(<OverviewScreen />);
    fireEvent.click(screen.getByText("Manage pipeline"));
    fireEvent.click(screen.getByRole("button", { name: "New pipeline" }));
    fireEvent.change(screen.getByPlaceholderText("Pipeline name"), { target: { value: "Test pipeline" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The pipeline could not be saved"));
    expect(screen.getByTestId("pipeline-name-editor")).toBeVisible();
  });

  it("keeps pipeline deletion reviewable after a failed request", async () => {
    pipeline.value = { ...createPipelineValue(), deletePipeline: vi.fn(async () => false) };
    renderScreen(<OverviewScreen />);
    fireEvent.click(screen.getByText("Manage pipeline"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByTestId("delete-pipeline-dialog");
    expect(dialog).toHaveTextContent("Structure Aware");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("The pipeline could not be deleted"));
    expect(dialog).toBeVisible();
  });

  it("keeps the active document and pipeline context visible on Parsing", () => {
    renderScreen(<ParseScreen />);

    const context = screen.getByTestId("pipeline-context-bar");
    expect(context).toBeVisible();
    expect(context).not.toHaveClass("sr-only");
    expect(screen.getByTestId("pipeline-context-document-selector")).toHaveTextContent("annual-report.pdf");
    expect(screen.getByTestId("pipeline-context-pipeline-selector")).toHaveTextContent("Structure Aware");
    expect(screen.getByTestId("parse-workspace-controls")).toContainElement(screen.getByTestId("parse-document-status"));
    expect(screen.getByTestId("parse-document-status")).toHaveTextContent("Parsed");
    expect(screen.queryByTestId("parse-reports-action")).not.toBeInTheDocument();
    expect(screen.getByTestId("parse-run-action")).toHaveTextContent("Parse again");
    expect(screen.getByTestId("parse-run-action")).toHaveAttribute("data-variant", "outline");
    expect(screen.queryByRole("navigation", { name: "Indexing lineage" })).not.toBeInTheDocument();
    // The selected parse run is complete, so Chunking is the primary next step.
    expect(screen.getByTestId("parse-next-action")).toHaveAttribute("href", "/chunking");
    expect(screen.getByTestId("parse-next-action")).toHaveTextContent("Continue to Chunking");
  });

  it("offers Parse, not Parse again, when the selected pipeline has no parse yet", () => {
    const freshPipeline = { ...savedPipeline, id: "pipeline-2", name: "Fresh", parseRunId: null, chunkRunId: null, embeddingRunId: null, isDefault: false };
    pipeline.value = {
      ...createPipelineValue(),
      // The document still has a default parse from another pipeline; it does not count here.
      activePipeline: freshPipeline,
      activePipelineId: freshPipeline.id,
      pipelines: [savedPipeline, freshPipeline],
      selectedParseRunId: null,
      selectedChunkRunId: null,
      selectedEmbeddingRunId: null,
      selectedChunkRun: null,
      selectedEmbeddingRun: null,
      chunkRun: null,
      embeddingRun: null,
      parseStatus: "not-started",
      parsePhase: null,
      parseProgress: 0,
      reparseImpact: { target: "pipeline", pipelineId: freshPipeline.id, pipelineName: freshPipeline.name, clearsChunk: false, clearsEmbedding: false, requiresConfirmation: false },
    };
    renderScreen(<ParseScreen />);

    const header = screen.getByTestId("parse-run-action");
    expect(header).toHaveTextContent(/^Parse$/);
    // One primary action per page: the empty state carries it.
    expect(header).toHaveAttribute("data-variant", "outline");
    expect(header).not.toHaveAccessibleDescription(/Runs the parser service again/);
    expect(screen.getByText("Nothing parsed yet")).toBeInTheDocument();
    const emptyAction = screen.getByTestId("parse-empty-action");
    expect(emptyAction).toHaveTextContent(/^Parse$/);
    expect(emptyAction).toHaveAttribute("data-variant", "primary");
    fireEvent.click(emptyAction);
    expect(call("reparseActiveDocument")).toHaveBeenCalledTimes(1);
  });

  it("keeps Parse again and no empty-state action once the pipeline has a parse", () => {
    pipeline.value = createPipelineValue();
    renderScreen(<ParseScreen />);
    expect(screen.getByTestId("parse-run-action")).toHaveTextContent("Parse again");
    expect(screen.queryByTestId("parse-empty-action")).not.toBeInTheDocument();
  });

  it("shows the active document on Embeddings with one dominant Playground CTA", () => {
    renderScreen(<EmbeddingsScreen />);

    expect(screen.getByTestId("pipeline-context-bar")).toHaveTextContent("annual-report.pdf");
    expect(screen.getByTestId("pipeline-context-pipeline-selector")).toHaveTextContent("Structure Aware");
    expect(screen.queryByTestId("embedding-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("embedding-primary-result")).toHaveTextContent("12 chunks");
    expect(screen.getByTestId("embedding-output-result")).toHaveTextContent("12 vectors");
    // Model and vector size label the chunks → vectors arrow; the details keep storage/provenance only.
    expect(screen.getByTestId("embedding-lineage")).toHaveTextContent("gemini");
    expect(screen.getByTestId("embedding-lineage")).toHaveTextContent("768 dimensions");
    expect(screen.getByTestId("embedding-details")).not.toHaveAttribute("open");
    expect(screen.getByTestId("embedding-details")).toHaveTextContent("Stored in pgvector");
    // Real provenance: which chunking run produced these vectors.
    expect(screen.getByTestId("embedding-details")).toHaveTextContent("Chunking #1");
    expect(screen.getAllByRole("link", { name: /Continue to Playground/ })).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: /Continue to Playground/ })).toHaveLength(0);
    // The embeddings are current, so creating them again is the secondary action.
    expect(screen.getByTestId("embedding-run-action")).toHaveAttribute("data-variant", "outline");
    expect(screen.getByTestId("embedding-run-action")).toHaveAccessibleDescription("Calls the embedding model again for every chunk.");
    expect(screen.getByTestId("embeddings-next-action")).toHaveAttribute("data-variant", "default");
    expect(screen.getByTestId("embeddings-next-action-footer")).toContainElement(screen.getByTestId("embeddings-next-action"));
    expect(screen.getByTestId("embeddings-page-header")).not.toContainElement(screen.getByTestId("embeddings-next-action"));
    expect(screen.getByTestId("embeddings-page-header")).not.toContainElement(screen.getByTestId("embedding-run-action"));
    expect(screen.getByTestId("embedding-run-action")).toBeVisible();
  });

  it("keeps the locked next action visible with the reason that unlocks it", () => {
    pipeline.value = {
      ...createPipelineValue(),
      activeDocument: { ...activeDocument, activeEmbeddingRunId: null, embeddingRuns: [] },
      activePipeline: { ...savedPipeline, embeddingRunId: null },
      embeddingRun: null,
      selectedEmbeddingRun: null,
      pipelines: [{ ...savedPipeline, embeddingRunId: null }],
      selectedEmbeddingRunId: null,
    };
    renderScreen(<EmbeddingsScreen />);

    const next = screen.getByTestId("embeddings-next-action");
    expect(next).toBeDisabled();
    expect(next).toHaveTextContent("Continue to Playground");
    expect(next).toHaveAccessibleDescription(/Dense and hybrid retrieval require embeddings/);
    expect(within(screen.getByTestId("embeddings-next-action-footer")).getByRole("link", { name: /Go to Embeddings/ })).toHaveAttribute("href", "/embeddings");
    expect(screen.getByTestId("embedding-run-action")).toHaveAttribute("data-variant", "default");
    expect(screen.getByTestId("embedding-output-result")).toHaveTextContent("embeddings pending");
  });

  it("uses the same footer next-action slot on Chunking", () => {
    renderScreen(<ChunkingScreen />);

    expect(screen.getByTestId("chunking-next-action-footer")).toContainElement(screen.getByTestId("chunking-next-action"));
    expect(screen.getByTestId("chunking-page-header")).not.toContainElement(screen.getByTestId("chunking-next-action"));
    expect(screen.getByTestId("chunking-next-action")).toHaveAttribute("href", "/embeddings");
    expect(screen.getAllByRole("link", { name: /Continue to Embeddings/ })).toHaveLength(1);
    expect(screen.getByTestId("chunking-workspace")).toContainElement(screen.getByTestId("chunking-run-action"));
    expect(screen.getByTestId("chunking-config-card")).toContainElement(screen.getByTestId("chunk-compact-controls"));
    expect(screen.getByTestId("chunking-config-card")).toContainElement(screen.getByTestId("chunking-run-action"));
  });

  it("does not offer Embeddings as the next step while its lineage is blocked", () => {
    // The selected chunk run is usable, but its parse run no longer matches the pipeline.
    pipeline.value = { ...createPipelineValue(), activeDocument: { ...activeDocument, parseRuns: [{ ...parseRun, isCompatible: false }] } };
    renderScreen(<ChunkingScreen />);

    const next = screen.getByTestId("chunking-next-action");
    expect(next).toBeDisabled();
    expect(screen.queryByRole("link", { name: /Continue to Embeddings/ })).not.toBeInTheDocument();
  });

  it("does not offer a next step for an unselected inspected embedding", () => {
    pipeline.value = { ...createPipelineValue(), selectedEmbeddingRunId: "another-run" };
    renderScreen(<EmbeddingsScreen />);
    expect(screen.getByTestId("embeddings-next-action")).toBeDisabled();
    expect(screen.queryByRole("link", { name: /Continue to Playground/ })).not.toBeInTheDocument();
  });

  it("locks the Chunking next step without an upstream parse selection", () => {
    pipeline.value = { ...createPipelineValue(), selectedParseRunId: null };
    renderScreen(<ChunkingScreen />);
    expect(screen.getByTestId("chunking-next-action")).toBeDisabled();
    expect(screen.queryByRole("link", { name: /Continue to Embeddings/ })).not.toBeInTheDocument();
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

describe("Build-stage UX safety nets", () => {
  beforeEach(() => {
    pipeline.value = createPipelineValue();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("confirms a reparse that would clear the pipeline's chunks and embeddings", async () => {
    renderScreen(<ParseScreen />);
    fireEvent.click(screen.getByTestId("parse-run-action"));
    const dialog = await screen.findByTestId("reparse-dialog");
    expect(dialog).toHaveTextContent("“Structure Aware” will stop using its current chunks and embeddings.");
    expect(dialog).toHaveTextContent("Earlier results stay in history.");
    expect(dialog).toHaveTextContent("Parsing runs the parser service again");
    expect(call("reparseActiveDocument")).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("reparse-dialog")).not.toBeInTheDocument());
    expect(call("reparseActiveDocument")).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("parse-run-action"));
    fireEvent.click(within(await screen.findByTestId("reparse-dialog")).getByRole("button", { name: "Parse again" }));
    expect(call("reparseActiveDocument")).toHaveBeenCalledTimes(1);
  });

  it("reparses directly when no downstream selection would be cleared", () => {
    pipeline.value = {
      ...createPipelineValue(),
      reparseImpact: { target: "pipeline", pipelineId: savedPipeline.id, pipelineName: savedPipeline.name, clearsChunk: false, clearsEmbedding: false, requiresConfirmation: false },
    };
    renderScreen(<ParseScreen />);
    fireEvent.click(screen.getByTestId("parse-run-action"));
    expect(screen.queryByTestId("reparse-dialog")).not.toBeInTheDocument();
    expect(call("reparseActiveDocument")).toHaveBeenCalledTimes(1);
  });

  it("keeps a persistent inspection band with use and back actions", () => {
    const inspectedParse = { ...parseRun, id: "parse-2", runNumber: 2 };
    pipeline.value = {
      ...createPipelineValue(),
      activeDocument: { ...activeDocument, parseRuns: [parseRun, inspectedParse] },
      inspectedParseRunId: inspectedParse.id,
    };
    renderScreen(<ParseScreen />);
    const band = screen.getByTestId("parse-inspection-band");
    expect(band).toHaveTextContent("Inspecting Parse #2; the pipeline uses Parse #1.");
    fireEvent.click(within(band).getByRole("button", { name: "Use in pipeline" }));
    expect(call("setPipelineParseRun")).toHaveBeenCalledWith("parse-2");
    fireEvent.click(within(band).getByRole("button", { name: "Back to pipeline result" }));
    expect(call("inspectParseRun")).toHaveBeenCalledWith("parse-1");

    // One badge vocabulary; normal states ("Selected", "Compatible") stay silent.
    const history = screen.getByTestId("parse-history");
    expect(history).toHaveTextContent("In use");
    expect(history).toHaveTextContent("Inspecting");
    expect(history).not.toHaveTextContent(/Selected|Compatible/);
  });

  it("shows no inspection band while the pipeline's own run is on screen", () => {
    pipeline.value = { ...createPipelineValue(), inspectedChunkRunId: chunkRun.id };
    renderScreen(<ChunkingScreen />);
    expect(screen.queryByTestId("chunk-inspection-band")).not.toBeInTheDocument();
  });

  it("makes continuing primary while chunking is current and running primary once the form changes", () => {
    renderScreen(<ChunkingScreen />);
    const run = screen.getByTestId("chunking-run-action");
    expect(run).toHaveAttribute("data-variant", "outline");
    expect(run).toHaveAccessibleDescription(/new chunk set/);
    expect(screen.getByTestId("chunk-config-state")).toHaveTextContent("Matches Chunking #1");
    expect(screen.getByTestId("chunking-next-action")).toHaveAttribute("data-variant", "default");

    fireEvent.change(screen.getByLabelText(/Chunk size/), { target: { value: "300" } });
    expect(run).toHaveAttribute("data-variant", "default");
    expect(screen.getByTestId("chunk-config-state")).toHaveTextContent("Changed from Chunking #1");
    expect(screen.getByTestId("chunking-next-action")).toHaveAttribute("data-variant", "outline");
  });

  it("offers Resume tracking after the parse poll times out", () => {
    pipeline.value = {
      ...createPipelineValue(),
      parseStatus: "running",
      parseError: { code: "parse_poll_timeout", message: "Refresh to resume status checks." },
      resumeParseTracking: vi.fn(asyncNoop),
    };
    renderScreen(<ParseScreen />);
    const notice = screen.getByTestId("parse-poll-timeout");
    expect(notice).toHaveTextContent("Status tracking paused after 15 minutes; parsing may still be running.");
    expect(notice).not.toHaveTextContent("Refresh");
    fireEvent.click(within(notice).getByRole("button", { name: "Resume tracking" }));
    expect(call("resumeParseTracking")).toHaveBeenCalledTimes(1);
  });

  it("continues to Evaluation once a matching experiment is complete", () => {
    const experiment = {
      id: "experiment-1",
      isCompatible: true,
      chunkRunId: chunkRun.id,
      embeddingRunId: embeddingRun.id,
      status: "completed",
      stageStatuses: { retrieval: "completed", reranking: "skipped", context: "completed", generation: "completed" },
    };
    pipeline.value = { ...createPipelineValue(), activeDocument: { ...activeDocument, experiments: [experiment] } };
    renderScreen(<OverviewScreen />);
    expect(screen.getByTestId("overview-continue-action")).toHaveAttribute("href", "/evaluation");
    expect(screen.getByTestId("overview-continue-action")).toHaveTextContent("Continue to Evaluation");
    expect(screen.getByTestId("overview-journey-node-evaluate")).toHaveAttribute("data-state", "Ready");
  });

  it("explains a locked journey step with the action that unlocks it", () => {
    pipeline.value = {
      ...createPipelineValue(),
      activeDocument: { ...activeDocument, embeddingRuns: [] },
      selectedEmbeddingRunId: null,
      selectedEmbeddingRun: null,
      embeddingRun: null,
      embeddingStatus: "ready",
    };
    renderScreen(<OverviewScreen />);
    expect(screen.getByTestId("overview-compact-journey-reason-retrieve")).toHaveTextContent("Dense and hybrid retrieval require embeddings");
    // The shared reason is printed once; later locked steps reference it instead of repeating it.
    expect(within(screen.getByTestId("overview-journey-compact")).getAllByText(/Dense and hybrid retrieval require embeddings/)).toHaveLength(1);
    expect(screen.getByTestId("overview-compact-journey-node-evaluate")).toHaveAccessibleDescription(/Dense and hybrid retrieval require embeddings/);
    fireEvent.focus(screen.getByTestId("overview-journey-node-retrieve"));
    expect(screen.getByTestId("overview-journey-reason")).toHaveTextContent("Retrieval: Dense and hybrid retrieval require embeddings");
  });

  it("does not borrow the document's latest parse for an empty pipeline (B-9)", () => {
    pipeline.value = {
      ...createPipelineValue(),
      activePipeline: { ...savedPipeline, parseRunId: null, chunkRunId: null, embeddingRunId: null },
      selectedParseRunId: null,
      selectedChunkRunId: null,
      selectedEmbeddingRunId: null,
      chunkStatus: "locked",
      embeddingStatus: "locked",
    };
    render(<PreferencesProvider><PipelineContextBar /></PreferencesProvider>);
    const lineage = screen.getByRole("navigation", { name: "Indexing lineage" });
    expect(within(lineage).getByRole("link", { name: /Parsing/ })).toHaveAttribute("data-status", "ready");
    expect(within(lineage).getByRole("link", { name: /Chunking/ })).toHaveAttribute("data-status", "locked");
    // "default" is a list-only marker, never part of the trigger text.
    expect(screen.getByTestId("pipeline-context-pipeline-selector")).toHaveTextContent(/^Structure Aware$/);
  });

  it("renders Markdown pipe tables in a chunk as a plain-text table", () => {
    const tableChunk = {
      id: "chunk-table",
      ordinal: 0,
      text: "Intro line\n| Field | Value |\n|---|---|\n| Version | 2.4 |\n| <b>Raw</b> | x \\| y |\nAfter the table",
      tokenCount: 20,
      pageNumbers: [2],
      headingPath: ["Profile"],
      sourceElementIds: ["element-1", "element-2"],
    };
    pipeline.value = { ...createPipelineValue(), chunkRun: { ...chunkRun, chunks: [tableChunk] } };
    renderScreen(<ChunkingScreen />);
    const detail = screen.getByTestId("chunk-inspector-detail");
    const table = within(detail).getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Field", "Value"]);
    expect(within(table).getByRole("cell", { name: "2.4" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "<b>Raw</b>" })).toBeInTheDocument();
    expect(table.querySelector("b")).toBeNull();
    expect(within(table).getByRole("cell", { name: "x | y" })).toBeInTheDocument();
    expect(detail).toHaveTextContent("Intro line");
    expect(detail).toHaveTextContent("After the table");
    expect(detail).not.toHaveTextContent("|---|");
    // Source element IDs render as whole tokens, never broken mid-word.
    expect(within(screen.getByTestId("chunk-technical-details")).getAllByText(/^element-\d$/)).toHaveLength(2);
  });

  it("opens the run history from an incompatible-lineage blocker", () => {
    pipeline.value = {
      ...createPipelineValue(),
      activePipeline: { ...savedPipeline, chunkRunId: "chunk-elsewhere" },
    };
    renderScreen(<EmbeddingsScreen />);
    expect(screen.getByTestId("embedding-blocker")).toHaveAttribute("data-code", "incompatible_lineage");
    // The lineage warning stays; the "Open history" button is the way out, so the sentence does not restate it.
    expect(screen.getByTestId("embedding-blocker")).toHaveTextContent("This result doesn't match the current pipeline.");
    expect(screen.getByTestId("embedding-blocker")).not.toHaveTextContent(/history/i);
    const history = screen.getByTestId("embedding-history").querySelector("details")!;
    expect(history).not.toHaveAttribute("open");
    fireEvent.click(screen.getByTestId("embedding-open-history"));
    expect(history.open).toBe(true);
  });
});
