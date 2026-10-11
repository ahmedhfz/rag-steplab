import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentPipelineProvider, useDocumentPipeline } from "@/components/document-pipeline-provider";

const navigationState = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

const capabilities = {
  embeddingModel: "gemini",
  embeddingDimensions: 768,
  generationModel: "gemini",
  rerankModel: "gemini",
  judgeModel: "gemini",
  embeddingFormatVersion: "v1",
  limits: {},
};

function parseResult(documentId: string, parseRunId: string, fileName: string, heading: string) {
  return {
    document: { id: documentId, fileName, mediaType: "application/pdf", sizeBytes: 9, pageCount: 1 },
    structured: {
      pages: [{ pageNumber: 1, elements: [{ id: `element-${parseRunId}`, type: "heading", pageNumbers: [1], text: heading, level: 1, table: null }] }],
      elements: [{ id: `element-${parseRunId}`, type: "heading", pageNumbers: [1], text: heading, level: 1, table: null }],
    },
    markdown: `# ${heading}`,
    summary: { pageCount: 1, headingCount: 1, paragraphCount: 0, listCount: 0, tableCount: 0 },
    documentId,
    parseRunId,
    status: "completed",
    runMetadata: { parser: "docling" },
  };
}

function chunkRun(documentId: string, parseRunId: string, runId: string) {
  return {
    id: runId,
    status: "completed",
    documentId,
    parseRunId,
    strategy: "fixed_token",
    config: {},
    chunkCount: 1,
    chunks: [{
      id: `${runId}-chunk`,
      ordinal: 0,
      text: "A persisted chunk",
      pageNumbers: [1],
      sourceElementIds: [],
      headingPath: [],
      tokenCount: 3,
      characterCount: 18,
    }],
  };
}

function documentDetail() {
  return {
    id: "document-old",
    fileName: "lesson.pdf",
    mediaType: "application/pdf",
    sizeBytes: 9,
    pageCount: 1,
    activeParseRunId: "parse-new",
    activeChunkRunId: "chunk-new",
    activeEmbeddingRunId: null,
    parseRuns: [
      { id: "parse-new", status: "completed", isCompatible: true },
      { id: "parse-old", status: "completed", isCompatible: true, historicalLineage: true },
    ],
    chunkRuns: [
      { id: "chunk-new", status: "completed", isCompatible: true, upstream: { parseRunId: "parse-new" } },
      { id: "chunk-old", status: "completed", isCompatible: true, historicalLineage: true, upstream: { parseRunId: "parse-old" } },
    ],
    embeddingRuns: [],
    experiments: [],
    evaluationDatasets: [],
    evaluationRuns: [],
  };
}

function persistedDocument() {
  return {
    id: "document-old",
    fileName: "lesson.pdf",
    mediaType: "application/pdf",
    sizeBytes: 9,
    pageCount: 1,
    activeParseRunId: "parse-new",
    activeChunkRunId: "chunk-new",
    activeEmbeddingRunId: null,
  };
}

function summaryDocument(documentId: string, fileName: string) {
  const parseRunId = `${documentId}-parse`;
  return {
    ...persistedDocument(),
    id: documentId,
    fileName,
    activeParseRunId: parseRunId,
    activeChunkRunId: null,
    parseRuns: [{ id: parseRunId, status: "completed", progress: 100, isCompatible: true, isStale: false, upstream: { documentId, parseRunId: null, chunkRunId: null, embeddingRunId: null }, config: {}, timing: {}, error: null }],
    chunkRuns: [],
    embeddingRuns: [],
    experiments: [],
    evaluationDatasets: [],
  };
}

function selectableLineageSummary() {
  const base = summaryDocument("document-old", "lesson.pdf");
  return {
    ...base,
    activeChunkRunId: "chunk-new",
    activeEmbeddingRunId: "embedding-new",
    parseRuns: [
      ...base.parseRuns,
      { ...base.parseRuns[0], id: "parse-old", historicalLineage: true },
    ],
    chunkRuns: [
      { id: "chunk-new", status: "completed", isCompatible: true, upstream: { parseRunId: "document-old-parse" } },
      { id: "chunk-alt", status: "completed", isCompatible: true, historicalLineage: true, upstream: { parseRunId: "document-old-parse" } },
    ],
    embeddingRuns: [
      { id: "embedding-new", status: "completed", isCompatible: true, upstream: { chunkRunId: "chunk-new" } },
      { id: "embedding-alt", status: "completed", isCompatible: true, historicalLineage: true, upstream: { chunkRunId: "chunk-alt" } },
    ],
  };
}

function namedPipeline(id: string, overrides: Partial<Record<"parseRunId" | "chunkRunId" | "embeddingRunId" | "revision", string | number | null>> = {}) {
  return {
    id,
    documentId: "document-old",
    name: id,
    parseRunId: "document-old-parse",
    chunkRunId: "chunk-new",
    embeddingRunId: "embedding-new",
    revision: 1,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function Probe() {
  const {
    activeDocument,
    activeDocumentId,
    persistenceError,
    selectedParseRunId,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    inspectedParseRunId,
    inspectedChunkRunId,
    inspectedEmbeddingRunId,
    activePipelineId,
    evaluationDatasets,
    evaluationRun,
    selectParseRun,
    selectChunkRun,
    selectEmbeddingRun,
    setPipelineParseRun,
    setPipelineChunkRun,
    setPipelineEmbeddingRun,
    selectPipeline,
    createPipeline,
    renamePipeline,
    pipelines,
    selectPersistedDocument,
    refreshEvaluationRuns,
    experimentRun,
    experimentStatus,
    loadExperiment,
    resumeRunTracking,
    reparseActiveDocument,
    resumeParseTracking,
    parseResult: viewedParseResult,
    selectedParseResult,
    workspaceStatus,
    reparseImpact,
    runEmbedding,
    embeddingStatus,
    embeddingError,
  } = useDocumentPipeline();

  return (
    <div>
      <output data-testid="experiment-state">{experimentRun?.id}:{experimentRun?.status}:{experimentStatus}</output>
      <button onClick={() => void loadExperiment("tracked-run")}>Load tracked</button>
      <button onClick={() => void resumeRunTracking("experiment")}>Resume tracked</button>
      <output data-testid="active-document">{activeDocument?.id ?? "none"}</output>
      <output data-testid="active-document-id">{activeDocumentId ?? "none"}</output>
      <output data-testid="selected-parse">{selectedParseRunId ?? "none"}</output>
      <output data-testid="selected-chunk">{selectedChunkRunId ?? "none"}</output>
      <output data-testid="selected-embedding">{selectedEmbeddingRunId ?? "none"}</output>
      <output data-testid="inspected-parse">{inspectedParseRunId ?? "none"}</output>
      <output data-testid="inspected-chunk">{inspectedChunkRunId ?? "none"}</output>
      <output data-testid="inspected-embedding">{inspectedEmbeddingRunId ?? "none"}</output>
      <output data-testid="active-pipeline">{activePipelineId ?? "none"}</output>
      <output data-testid="evaluation-dataset-count">{evaluationDatasets.length}</output>
      <output data-testid="evaluation-run-id">{evaluationRun?.id ?? "none"}</output>
      <output data-testid="evaluation-case-count">{evaluationRun?.caseResults?.length ?? 0}</output>
      <output data-testid="artifact-count">{activeDocument?.chunkRuns.length ?? 0}</output>
      <output data-testid="persistence-error">{persistenceError?.code ?? "none"}</output>
      <output data-testid="viewed-parse-result">{viewedParseResult?.parseRunId ?? "none"}</output>
      <output data-testid="selected-parse-result">{selectedParseResult?.parseRunId ?? "none"}</output>
      <output data-testid="workspace-status">{workspaceStatus ?? "unknown"}</output>
      <output data-testid="reparse-impact">{reparseImpact ? `${reparseImpact.target}:${reparseImpact.requiresConfirmation}` : "unknown"}</output>
      <button onClick={() => void reparseActiveDocument()} type="button">Reparse document</button>
      <button onClick={() => void resumeParseTracking()} type="button">Resume parse tracking</button>
      <button onClick={() => void runEmbedding()} type="button">Run embedding</button>
      <output data-testid="embedding-status">{embeddingStatus}:{embeddingError?.code ?? "none"}</output>
      <button onClick={() => void selectPersistedDocument("document-new")} type="button">Switch to new</button>
      <button onClick={() => void selectPersistedDocument("document-old")} type="button">Switch to old</button>
      <button onClick={() => void selectParseRun("parse-old")} type="button">Select historical parse</button>
      <button onClick={() => void selectChunkRun("chunk-alt")} type="button">Select alternate chunk</button>
      <button onClick={() => void selectEmbeddingRun("embedding-alt")} type="button">Select alternate embedding</button>
      <button onClick={() => void setPipelineParseRun("parse-old")} type="button">Use historical parse in pipeline</button>
      <button onClick={() => void setPipelineChunkRun("chunk-alt")} type="button">Use alternate chunk in pipeline</button>
      <button onClick={() => void setPipelineEmbeddingRun("embedding-alt")} type="button">Use alternate embedding in pipeline</button>
      <button onClick={() => void selectPipeline("pipeline-1")} type="button">Select pipeline one</button>
      <button onClick={() => void selectPipeline("pipeline-2")} type="button">Select pipeline two</button>
      <button onClick={() => void createPipeline("Blank pipeline")} type="button">Create blank pipeline</button>
      <button onClick={() => void renamePipeline("pipeline-1", "Renamed")} type="button">Rename pipeline one</button>
      <output data-testid="pipeline-names">{pipelines.map((item) => `${item.documentId}/${item.name}`).join(",") || "none"}</output>
      <button onClick={() => void refreshEvaluationRuns("dataset-1")} type="button">Refresh evaluation runs</button>
    </div>
  );
}

function renderProbe() {
  return render(<DocumentPipelineProvider><Probe /></DocumentPipelineProvider>);
}

function setupSummaryFetch() {
  const old = summaryDocument("document-old", "lesson.pdf");
  const next = summaryDocument("document-new", "new.pdf");
  localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
    if (url.endsWith("/capabilities")) return respond(capabilities);
    if (url.endsWith("/documents")) return respond({ items: [persistedDocument(), { ...persistedDocument(), id: "document-new", fileName: "new.pdf" }] });
    if (url.endsWith("/pipelines")) return respond([]);
    if (url.endsWith("/documents/document-old/summary")) return respond(old);
    if (url.endsWith("/documents/document-new/summary")) return respond(next);
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setupFetch({ newDocumentMode = "error" as "error" | "delayed" } = {}) {
  localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
  const detail = documentDetail();
  const oldParse = parseResult("document-old", "parse-old", "lesson.pdf", "Historical parse");
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
    if (url.endsWith("/capabilities")) return respond(capabilities);
    if (url.endsWith("/documents")) return respond({ items: [persistedDocument(), { ...persistedDocument(), id: "document-new", fileName: "new.pdf" }] });
    if (url.endsWith("/pipelines")) return respond([]);
    if (url.endsWith("/documents/document-old/summary")) return respond(detail);
    if (url.endsWith("/documents/document-new/summary")) {
      if (newDocumentMode === "delayed") return new Promise((resolve) => setTimeout(() => resolve(respond({ error: { code: "late_document", message: "Late document response" } }, 500)), 50));
      return respond({ error: { code: "document_unavailable", message: "The document could not be loaded." } }, 500);
    }
    if (url.endsWith("/parse-runs/parse-old")) return respond(oldParse);
    if (url.endsWith("/chunk-runs/chunk-new")) return respond(chunkRun("document-old", "parse-new", "chunk-new"));
    if (url.includes("/experiments") || url.includes("/evaluation/datasets")) return respond({ items: [] });
    return respond({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  navigationState.pathname = "/";
  vi.restoreAllMocks();
});

describe("Document pipeline committed state", () => {
  it("keeps cached history loading separate from fresh same-ID tracking", async () => {
    const fetch = setupSummaryFetch();
    const fallback = fetch.getMockImplementation()!;
    const status = "completed";
    fetch.mockImplementation((url: string) => url.endsWith("/experiments/tracked-run")
      ? Promise.resolve(new Response(JSON.stringify({ id: "tracked-run", status, documentId: "document-old", chunkRunId: "chunk-new", query: "q", targetStage: "retrieval", stageResults: { retrieval: { candidates: [], durationMs: 1 } } })))
      : url.endsWith("/experiments/tracked-run/status")
        ? Promise.resolve(new Response(JSON.stringify({ id: "tracked-run", status, stageStatuses: { retrieval: "completed" } })))
        : fallback(url));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("active-document")).toHaveTextContent("document-old"));
    fireEvent.click(screen.getByText("Load tracked"));
    await waitFor(() => expect(screen.getByTestId("experiment-state")).toHaveTextContent("tracked-run:completed:completed"));
    const reads = () => fetch.mock.calls.filter(([url]) => url.endsWith("/experiments/tracked-run")).length;
    expect(reads()).toBe(1);
    fireEvent.click(screen.getByText("Load tracked"));
    expect(reads()).toBe(1);
    fireEvent.click(screen.getByText("Resume tracked"));
    await waitFor(() => expect(reads()).toBe(2));
    await waitFor(() => expect(screen.getByTestId("experiment-state")).toHaveTextContent("tracked-run:completed:completed"));
    expect(reads()).toBe(2);
    expect(fetch.mock.calls.every((call) => !call[0].includes("rerun") && !call[0].includes("continue"))).toBe(true);
  });

  it("discards late tracking results after document selection changes", async () => {
    const fetch = setupSummaryFetch();
    const fallback = fetch.getMockImplementation()!;
    const run = { id: "tracked-run", status: "running", documentId: "document-old", chunkRunId: "chunk-new", query: "q", targetStage: "retrieval", stageResults: {} };
    let finish: ((response: Response) => void) | undefined;
    let reads = 0;
    fetch.mockImplementation((url: string) => {
      if (url.endsWith("/experiments/tracked-run/status")) {
        reads += 1;
        return new Promise<Response>((resolve) => { finish = resolve; });
      }
      if (!url.endsWith("/experiments/tracked-run")) return fallback(url);
      reads += 1;
      return Promise.resolve(new Response(JSON.stringify(run)));
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("active-document")).toHaveTextContent("document-old"));
    fireEvent.click(screen.getByText("Load tracked"));
    await waitFor(() => expect(screen.getByTestId("experiment-state")).toHaveTextContent("tracked-run:running:ready"));
    fireEvent.click(screen.getByText("Resume tracked"));
    await waitFor(() => expect(reads).toBe(2));
    fireEvent.click(screen.getByText("Switch to new"));
    await waitFor(() => expect(screen.getByTestId("active-document")).toHaveTextContent("document-new"));
    finish!(new Response(JSON.stringify({ id: "tracked-run", status: "failed", stageStatuses: {} })));
    await waitFor(() => expect(screen.getByTestId("experiment-state")).not.toHaveTextContent("tracked-run"));
  });
  it("surfaces a summary contract error instead of falling back to legacy endpoints", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/pipelines")) return respond([]);
      if (url.endsWith("/documents/document-old/summary")) return respond({
        ...summaryDocument("document-old", "lesson.pdf"),
        evaluationRuns: [{ id: "evaluation-1", status: "invalid" }],
      });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("persistence-error")).toHaveTextContent("invalid_response"));
    expect(screen.getByTestId("workspace-status")).toHaveTextContent("unavailable");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/documents/document-old"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/evaluation/datasets"))).toBe(false);
  });

  it("inspects a historical parse without changing the saved pipeline lineage", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:document:test-user:document-old", "pipeline-1");
    const detail = selectableLineageSummary();
    const pipeline = namedPipeline("pipeline-1");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/summary")) return respond(detail);
      if (url.endsWith("/documents/document-old/pipelines")) return respond([pipeline]);
      if (url.endsWith("/parse-runs/parse-old")) return respond(parseResult("document-old", "parse-old", "lesson.pdf", "Historical parse"));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("selected-parse")).toHaveTextContent("document-old-parse"));
    fireEvent.click(screen.getByRole("button", { name: "Select historical parse" }));

    await waitFor(() => expect(screen.getByTestId("inspected-parse")).toHaveTextContent("parse-old"));
    expect(screen.getByTestId("selected-parse")).toHaveTextContent("document-old-parse");
    expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("inspects a historical chunk without changing the saved pipeline lineage", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:document:test-user:document-old", "pipeline-1");
    const detail = selectableLineageSummary();
    const pipeline = namedPipeline("pipeline-1");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/summary")) return respond(detail);
      if (url.endsWith("/documents/document-old/pipelines")) return respond([pipeline]);
      if (url.endsWith("/chunk-runs/chunk-alt")) return respond(chunkRun("document-old", "document-old-parse", "chunk-alt"));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("selected-chunk")).toHaveTextContent("chunk-new"));
    fireEvent.click(screen.getByRole("button", { name: "Select alternate chunk" }));

    await waitFor(() => expect(screen.getByTestId("inspected-chunk")).toHaveTextContent("chunk-alt"));
    expect(screen.getByTestId("selected-chunk")).toHaveTextContent("chunk-new");
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("embedding-new");
    expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("clears downstream lineage when a parse run is explicitly used by a pipeline", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:document:test-user:document-old", "pipeline-1");
    const detail = selectableLineageSummary();
    const pipeline = namedPipeline("pipeline-1");
    let patchBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/summary")) return respond(detail);
      if (url.endsWith("/documents/document-old/pipelines")) return respond([pipeline]);
      if (url.endsWith("/document-pipelines/pipeline-1") && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return respond({ ...pipeline, revision: 2, parseRunId: "parse-old", chunkRunId: null, embeddingRunId: null });
      }
      if (url.endsWith("/parse-runs/parse-old")) return respond(parseResult("document-old", "parse-old", "lesson.pdf", "Historical parse"));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("selected-embedding")).toHaveTextContent("embedding-new"));
    fireEvent.click(screen.getByRole("button", { name: "Use historical parse in pipeline" }));

    await waitFor(() => expect(screen.getByTestId("selected-parse")).toHaveTextContent("parse-old"));
    expect(screen.getByTestId("selected-chunk")).toHaveTextContent("none");
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("none");
    expect(patchBody).toMatchObject({ parseRunId: "parse-old", chunkRunId: null, embeddingRunId: null, expectedRevision: 1 });
  });

  it("rejects an embedding that is not a child of the active pipeline chunk", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:document:test-user:document-old", "pipeline-1");
    const detail = selectableLineageSummary();
    const pipeline = namedPipeline("pipeline-1");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/summary")) return respond(detail);
      if (url.endsWith("/documents/document-old/pipelines")) return respond([pipeline]);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("selected-embedding")).toHaveTextContent("embedding-new"));
    fireEvent.click(screen.getByRole("button", { name: "Use alternate embedding in pipeline" }));

    await waitFor(() => expect(screen.getByTestId("persistence-error")).toHaveTextContent("incompatible_lineage"));
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("embedding-new");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("hydrates the latest persisted evaluation result after the history summary loads", async () => {
    navigationState.pathname = "/evaluation";
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    const detail = {
      ...summaryDocument("document-old", "lesson.pdf"),
      activeChunkRunId: "chunk-new",
      activeEmbeddingRunId: "embedding-new",
      chunkRuns: [{ id: "chunk-new", status: "completed", isCompatible: true, upstream: { parseRunId: "document-old-parse" } }],
      embeddingRuns: [{ id: "embedding-new", status: "completed", isCompatible: true, upstream: { chunkRunId: "chunk-new" } }],
      evaluationDatasets: [{ id: "dataset-1", documentId: "document-old", parseRunId: "document-old-parse", name: "Smoke", version: 1, caseCount: 1, createdAt: null }],
      evaluationRuns: [{ id: "evaluation-1", datasetId: "dataset-1", parseRunId: "document-old-parse", chunkRunId: "chunk-new", embeddingRunId: "embedding-new", status: "completed", timing: {}, error: null }],
    };
    const runDetail = {
      id: "evaluation-1",
      datasetId: "dataset-1",
      status: "completed",
      timing: { durationMs: 42 },
      results: { aggregate: { hitAtK: 1, recallAtK: 1, precisionAtK: 1, mrr: 1, citationValidity: 1, groundedness: 1, caseCount: 1 }, caseResults: [{ question: "What is RAG?", hitAtK: 1, recallAtK: 1, precisionAtK: 1, mrr: 1, citationValidity: 1, groundedness: 1, experimentId: "experiment-1" }] },
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/summary")) return respond(detail);
      if (url.endsWith("/documents/document-old/pipelines")) return respond([]);
      if (url.endsWith("/evaluation/datasets/dataset-1")) return respond({ id: "dataset-1", documentId: "document-old", parseRunId: "document-old-parse", name: "Smoke", version: 1, cases: [{ question: "What is RAG?", relevantElementIds: ["element-1"], referenceAnswer: null }], createdAt: null });
      if (url.endsWith("/evaluation/runs?datasetId=dataset-1")) return respond({ items: [{ ...detail.evaluationRuns[0], results: { hitAtK: 1, recallAtK: 1, precisionAtK: 1, mrr: 1, citationValidity: 1, groundedness: 1, caseCount: 1 } }] });
      if (url.endsWith("/evaluation/runs/evaluation-1")) return respond(runDetail);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("active-document")).toHaveTextContent("document-old"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh evaluation runs" }));

    await waitFor(() => expect(screen.getByTestId("evaluation-run-id")).toHaveTextContent("evaluation-1"));
    expect(screen.getByTestId("evaluation-case-count")).toHaveTextContent("1");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/evaluation/runs/evaluation-1"))).toBe(true);
  });

  it("reloads and reconciles server pipeline state before one revision-conflict retry", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:test-user", "pipeline-1");
    const base = summaryDocument("document-old", "lesson.pdf");
    const historical = {
      ...base.parseRuns[0], id: "parse-old", historicalLineage: true,
    };
    const detail = { ...base, parseRuns: [...base.parseRuns, historical] };
    const pipeline = { id: "pipeline-1", documentId: "document-old", name: "Baseline", parseRunId: "document-old-parse", chunkRunId: null, embeddingRunId: null, revision: 1, createdAt: null, updatedAt: null };
    let pipelineListCalls = 0;
    const patchBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/summary")) return respond(detail);
      if (url.endsWith("/documents/document-old/pipelines")) {
        pipelineListCalls += 1;
        return respond([{ ...pipeline, revision: pipelineListCalls === 1 ? 1 : 2 }]);
      }
      if (url.endsWith("/document-pipelines/pipeline-1") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patchBodies.push(body);
        if (patchBodies.length === 1) return respond({ error: { code: "pipeline_conflict", message: "changed" } }, 409);
        return respond({ ...pipeline, revision: 3, parseRunId: "parse-old" });
      }
      if (url.endsWith("/parse-runs/parse-old")) return respond(parseResult("document-old", "parse-old", "lesson.pdf", "Historical parse"));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("selected-parse")).toHaveTextContent("document-old-parse"));
    fireEvent.click(screen.getByRole("button", { name: "Use historical parse in pipeline" }));
    await waitFor(() => expect(screen.getByTestId("selected-parse")).toHaveTextContent("parse-old"));
    expect(pipelineListCalls).toBe(2);
    expect(patchBodies.map((body) => body.expectedRevision)).toEqual([1, 2]);
  });

  it("does not commit a stale conflict reload after another pipeline becomes active", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:test-user", "pipeline-1");
    const detail = selectableLineageSummary();
    const pipelineOne = namedPipeline("pipeline-1");
    const pipelineTwo = namedPipeline("pipeline-2");
    let pipelineListCalls = 0;
    let resolveConflictList!: (response: Response) => void;
    const conflictList = new Promise<Response>((resolve) => { resolveConflictList = resolve; });
    let patchCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/summary")) return respond(detail);
      if (url.endsWith("/documents/document-old/pipelines")) {
        pipelineListCalls += 1;
        return pipelineListCalls === 1 ? respond([pipelineOne, pipelineTwo]) : conflictList;
      }
      if (url.endsWith("/document-pipelines/pipeline-1") && init?.method === "PATCH") {
        patchCalls += 1;
        return respond({ error: { code: "pipeline_conflict", message: "changed" } }, 409);
      }
      if (url.endsWith("/parse-runs/parse-old")) return respond(parseResult("document-old", "parse-old", "lesson.pdf", "Historical parse"));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1"));
    fireEvent.click(screen.getByRole("button", { name: "Use historical parse in pipeline" }));
    expect(screen.getByTestId("selected-parse")).toHaveTextContent("parse-old");
    await waitFor(() => expect(pipelineListCalls).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: "Select pipeline two" }));
    expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-2");
    resolveConflictList(new Response(JSON.stringify([{ ...pipelineOne, revision: 2 }, pipelineTwo]), { status: 200, headers: { "Content-Type": "application/json" } }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-2");
    expect(screen.getByTestId("selected-parse")).toHaveTextContent("document-old-parse");
    expect(patchCalls).toBe(1);
  });

  it("updates artifact selection before PATCH and serializes revisions for one pipeline", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:test-user", "pipeline-1");
    const detail = selectableLineageSummary();
    const pipeline = namedPipeline("pipeline-1");
    let resolveFirstPatch!: (response: Response) => void;
    const firstPatch = new Promise<Response>((resolve) => { resolveFirstPatch = resolve; });
    const patchBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/summary")) return respond(detail);
      if (url.endsWith("/documents/document-old/pipelines")) return respond([pipeline]);
      if ((url.endsWith("/chunk-runs/chunk-alt") || url.endsWith("/embedding-runs/embedding-alt"))) return new Promise<Response>(() => undefined);
      if (url.endsWith("/document-pipelines/pipeline-1") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patchBodies.push(body);
        return patchBodies.length === 1
          ? firstPatch
          : respond({ ...pipeline, revision: 3, chunkRunId: "chunk-alt", embeddingRunId: "embedding-alt" });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("selected-chunk")).toHaveTextContent("chunk-new"));
    fireEvent.click(screen.getByRole("button", { name: "Use alternate chunk in pipeline" }));
    expect(screen.getByTestId("selected-chunk")).toHaveTextContent("chunk-alt");
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("none");
    fireEvent.click(screen.getByRole("button", { name: "Use alternate embedding in pipeline" }));
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("embedding-alt");
    await waitFor(() => expect(patchBodies).toHaveLength(1));

    resolveFirstPatch(new Response(JSON.stringify({ ...pipeline, revision: 2, chunkRunId: "chunk-alt", embeddingRunId: null }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await waitFor(() => expect(patchBodies).toHaveLength(2));
    expect(patchBodies.map((body) => body.expectedRevision)).toEqual([1, 2]);
    expect(screen.getByTestId("selected-chunk")).toHaveTextContent("chunk-alt");
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("embedding-alt");
  });

  it("rolls an optimistic selection back only while its request is still active", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:test-user", "pipeline-1");
    const detail = selectableLineageSummary();
    const pipeline = namedPipeline("pipeline-1");
    let listCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/summary")) return respond(detail);
      if (url.endsWith("/documents/document-old/pipelines")) {
        listCalls += 1;
        return respond([pipeline]);
      }
      if (url.endsWith("/document-pipelines/pipeline-1") && init?.method === "PATCH") return respond({ error: { code: "save_failed", message: "failed" } }, 500);
      if (url.endsWith("/parse-runs/parse-old")) return respond(parseResult("document-old", "parse-old", "lesson.pdf", "Historical parse"));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("selected-parse")).toHaveTextContent("document-old-parse"));
    fireEvent.click(screen.getByRole("button", { name: "Use historical parse in pipeline" }));
    expect(screen.getByTestId("selected-parse")).toHaveTextContent("parse-old");
    expect(screen.getByTestId("selected-chunk")).toHaveTextContent("none");
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("none");
    await waitFor(() => expect(screen.getByTestId("selected-parse")).toHaveTextContent("document-old-parse"));
    expect(screen.getByTestId("persistence-error")).toHaveTextContent("save_failed");
    expect(listCalls).toBe(2);
  });

  it("does not roll a newer pipeline selection back after an older PATCH failure", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:test-user", "pipeline-1");
    const detail = selectableLineageSummary();
    const pipelineOne = namedPipeline("pipeline-1");
    const pipelineTwo = namedPipeline("pipeline-2");
    let listCalls = 0;
    let resolvePatch!: (response: Response) => void;
    const delayedPatch = new Promise<Response>((resolve) => { resolvePatch = resolve; });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const respond = (payload: unknown) => Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/summary")) return respond(detail);
      if (url.endsWith("/documents/document-old/pipelines")) {
        listCalls += 1;
        return respond([pipelineOne, pipelineTwo]);
      }
      if (url.endsWith("/document-pipelines/pipeline-1") && init?.method === "PATCH") return delayedPatch;
      if (url.endsWith("/parse-runs/parse-old")) return respond(parseResult("document-old", "parse-old", "lesson.pdf", "Historical parse"));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1"));
    fireEvent.click(screen.getByRole("button", { name: "Use historical parse in pipeline" }));
    expect(screen.getByTestId("selected-parse")).toHaveTextContent("parse-old");
    fireEvent.click(screen.getByRole("button", { name: "Select pipeline two" }));
    expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-2");
    resolvePatch(new Response(JSON.stringify({ error: { code: "save_failed", message: "failed" } }), { status: 500, headers: { "Content-Type": "application/json" } }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-2");
    expect(screen.getByTestId("selected-parse")).toHaveTextContent("document-old-parse");
    expect(screen.getByTestId("persistence-error")).toHaveTextContent("none");
    expect(listCalls).toBe(1);
  });

  it("switches metadata immediately and uses one summary request without global refetch", async () => {
    const fetchMock = setupSummaryFetch();
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-document-id")).toHaveTextContent("document-old"));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/capabilities"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/documents"))).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Switch to new" }));
    expect(screen.getByTestId("active-document-id")).toHaveTextContent("document-new");
    await waitFor(() => expect(screen.getByTestId("active-document")).toHaveTextContent("document-new"));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/documents/document-new/summary"))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/documents/document-new"))).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/capabilities"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/documents"))).toHaveLength(1);
  });

  it("restores each document's saved pipeline after an A to B to A switch", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:document:test-user:document-old", "pipeline-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:document:test-user:document-new", "pipeline-new");
    const oldDetail = selectableLineageSummary();
    const newDetail = {
      ...summaryDocument("document-new", "new.pdf"),
      parseRuns: [{ ...summaryDocument("document-new", "new.pdf").parseRuns[0], id: "document-new-parse" }],
    };
    const oldPipeline = { ...namedPipeline("pipeline-old"), name: "Old pipeline" };
    const newPipeline = {
      ...oldPipeline,
      id: "pipeline-new",
      documentId: "document-new",
      name: "New pipeline",
      parseRunId: "document-new-parse",
      chunkRunId: null,
      embeddingRunId: null,
    };
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument(), { ...persistedDocument(), id: "document-new", fileName: "new.pdf" }] });
      if (url.endsWith("/documents/document-old/summary")) return respond(oldDetail);
      if (url.endsWith("/documents/document-new/summary")) return respond(newDetail);
      if (url.endsWith("/documents/document-old/pipelines")) return respond([oldPipeline]);
      if (url.endsWith("/documents/document-new/pipelines")) return respond([newPipeline]);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-old"));
    fireEvent.click(screen.getByRole("button", { name: "Switch to new" }));
    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-new"));
    expect(screen.getByTestId("selected-parse")).toHaveTextContent("document-new-parse");
    fireEvent.click(screen.getByRole("button", { name: "Switch to old" }));
    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-old"));
    expect(screen.getByTestId("selected-parse")).toHaveTextContent("document-old-parse");
    expect(screen.getByTestId("selected-chunk")).toHaveTextContent("chunk-new");
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("embedding-new");
  });

  it("starts document pipelines and summary requests in parallel", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    const started: string[] = [];
    let resolvePipelines!: (response: Response) => void;
    let resolveSummary!: (response: Response) => void;
    const deferredPipelines = new Promise<Response>((resolve) => { resolvePipelines = resolve; });
    const deferredSummary = new Promise<Response>((resolve) => { resolveSummary = resolve; });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const respond = (payload: unknown) => Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/pipelines")) {
        started.push("pipelines");
        return deferredPipelines;
      }
      if (url.endsWith("/documents/document-old/summary")) {
        started.push("summary");
        return deferredSummary;
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(started).toEqual(["pipelines", "summary"]));
    resolvePipelines(new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }));
    resolveSummary(new Response(JSON.stringify(summaryDocument("document-old", "lesson.pdf")), { status: 200, headers: { "Content-Type": "application/json" } }));
    await waitFor(() => expect(screen.getByTestId("active-document")).toHaveTextContent("document-old"));
  });

  it("reuses a fresh summary for a valid pipeline switch", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:test-user", "pipeline-1");
    const detail = summaryDocument("document-old", "lesson.pdf");
    const pipelines = [1, 2].map((revision) => ({
      id: `pipeline-${revision}`,
      documentId: "document-old",
      name: `Pipeline ${revision}`,
      parseRunId: "document-old-parse",
      chunkRunId: null,
      embeddingRunId: null,
      revision: 1,
      createdAt: null,
      updatedAt: null,
    }));
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const respond = (payload: unknown) => Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/pipelines")) return respond(pipelines);
      if (url.endsWith("/documents/document-old/summary")) return respond(detail);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1"));
    fireEvent.click(screen.getByRole("button", { name: "Select pipeline two" }));
    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-2"));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/documents/document-old/summary"))).toHaveLength(1);
  });

  it("creates a new pipeline with empty lineage and resets the selected journey state", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:test-user", "pipeline-1");
    const detail = selectableLineageSummary();
    const currentPipeline = namedPipeline("pipeline-1");
    const blankPipeline = namedPipeline("pipeline-new", {
      parseRunId: null,
      chunkRunId: null,
      embeddingRunId: null,
    });
    let createBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const respond = (payload: unknown) => Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/pipelines") && init?.method === "POST") {
        createBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return respond(blankPipeline);
      }
      if (url.endsWith("/documents/document-old/pipelines")) return respond([currentPipeline]);
      if (url.endsWith("/documents/document-old/summary")) return respond(detail);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1"));
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("embedding-new");
    fireEvent.click(screen.getByRole("button", { name: "Create blank pipeline" }));

    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-new"));
    expect(screen.getByTestId("selected-parse")).toHaveTextContent("none");
    expect(screen.getByTestId("selected-chunk")).toHaveTextContent("none");
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("none");
    expect(createBody).toEqual({
      name: "Blank pipeline",
      parseRunId: null,
      chunkRunId: null,
      embeddingRunId: null,
    });
  });

  it("does not extend summary freshness on cached switches and refetches after 60 seconds", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:test-user", "pipeline-1");
    const detail = summaryDocument("document-old", "lesson.pdf");
    const pipelines = [1, 2].map((revision) => ({
      id: `pipeline-${revision}`, documentId: "document-old", name: `Pipeline ${revision}`,
      parseRunId: "document-old-parse", chunkRunId: null, embeddingRunId: null,
      revision: 1, createdAt: null, updatedAt: null,
    }));
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const respond = (payload: unknown) => Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/pipelines")) return respond(pipelines);
      if (url.endsWith("/documents/document-old/summary")) return respond(detail);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1"));
    now.mockReturnValue(50_000);
    fireEvent.click(screen.getByRole("button", { name: "Select pipeline two" }));
    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-2"));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/documents/document-old/summary"))).toHaveLength(1);
    now.mockReturnValue(61_000);
    fireEvent.click(screen.getByRole("button", { name: "Select pipeline one" }));
    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1"));
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/documents/document-old/summary"))).toHaveLength(2);
  });

  it("keeps the last pipeline in a rapid A to B to A selection race", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:test-user", "pipeline-1");
    const detail = summaryDocument("document-old", "lesson.pdf");
    const pipelines = [namedPipeline("pipeline-1", { chunkRunId: null, embeddingRunId: null }), namedPipeline("pipeline-2", { chunkRunId: null, embeddingRunId: null })];
    const delayedSummaries: Array<(response: Response) => void> = [];
    let summaryCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const respond = (payload: unknown) => Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/pipelines")) return respond(pipelines);
      if (url.endsWith("/documents/document-old/summary")) {
        summaryCalls += 1;
        if (summaryCalls === 1) return respond(detail);
        return new Promise<Response>((resolve) => { delayedSummaries.push(resolve); });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1"));
    now.mockReturnValue(70_000);
    fireEvent.click(screen.getByRole("button", { name: "Select pipeline two" }));
    fireEvent.click(screen.getByRole("button", { name: "Select pipeline one" }));
    await waitFor(() => expect(delayedSummaries).toHaveLength(2));
    delayedSummaries[1](new Response(JSON.stringify(detail), { status: 200, headers: { "Content-Type": "application/json" } }));
    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1"));
    delayedSummaries[0](new Response(JSON.stringify(detail), { status: 200, headers: { "Content-Type": "application/json" } }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1");
  });

  it("does not bootstrap again when only the route changes", async () => {
    const fetchMock = setupSummaryFetch();
    const view = renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-document-id")).toHaveTextContent("document-old"));
    navigationState.pathname = "/settings";
    view.rerender(<DocumentPipelineProvider><Probe /></DocumentPipelineProvider>);

    expect(screen.getByTestId("active-document-id")).toHaveTextContent("document-old");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/capabilities"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/documents"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/documents/document-old/summary"))).toHaveLength(1);
  });

  it("preserves the committed document when a switch request fails", async () => {
    setupFetch();
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-document")).toHaveTextContent("document-old"));
    await waitFor(() => expect(screen.getByTestId("selected-parse")).toHaveTextContent("parse-new"));
    fireEvent.click(screen.getByRole("button", { name: "Switch to new" }));

    await waitFor(() => expect(screen.getByTestId("persistence-error")).toHaveTextContent("document_unavailable"));
    expect(screen.getByTestId("active-document")).toHaveTextContent("document-old");
    expect(screen.getByTestId("selected-parse")).toHaveTextContent("parse-new");
    expect(screen.getByTestId("selected-chunk")).toHaveTextContent("chunk-new");
  });

  it("ignores a late switch response and preserves compatible historical selections per document", async () => {
    const fetchMock = setupFetch({ newDocumentMode: "delayed" });
    const view = renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-document")).toHaveTextContent("document-old"));
    fireEvent.click(screen.getByRole("button", { name: "Switch to new" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to old" }));
    await waitFor(() => expect(screen.getByTestId("active-document")).toHaveTextContent("document-old"));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(screen.getByTestId("active-document")).toHaveTextContent("document-old");

    fireEvent.click(screen.getByRole("button", { name: "Select historical parse" }));
    await waitFor(() => expect(screen.getByTestId("selected-parse")).toHaveTextContent("parse-old"));
    expect(screen.getByTestId("selected-chunk")).toHaveTextContent("none");
    expect(screen.getByTestId("artifact-count")).toHaveTextContent("2");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);

    view.unmount();
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("selected-parse")).toHaveTextContent("parse-old"));
    expect(screen.getByTestId("selected-chunk")).toHaveTextContent("none");
  });
});

describe("Document pipeline lineage regressions", () => {
  function jsonResponse(payload: unknown, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  }

  it("does not PATCH a different saved pipeline when it becomes active during a reparse", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:document:test-user:document-old", "pipeline-1");
    const detail = selectableLineageSummary();
    const pipelineOne = namedPipeline("pipeline-1");
    const pipelineTwo = namedPipeline("pipeline-2", { chunkRunId: "chunk-alt", embeddingRunId: "embedding-alt" });
    let finishReparse!: (response: Response) => void;
    const patchedUrls: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return Promise.resolve(jsonResponse(capabilities));
      if (url.endsWith("/documents")) return Promise.resolve(jsonResponse({ items: [persistedDocument()] }));
      if (url.endsWith("/documents/document-old/summary")) return Promise.resolve(jsonResponse(detail));
      if (url.endsWith("/documents/document-old/pipelines")) return Promise.resolve(jsonResponse([pipelineOne, pipelineTwo]));
      if (url.endsWith("/documents/document-old/parse") && init?.method === "POST") {
        return new Promise<Response>((resolve) => { finishReparse = resolve; });
      }
      if (init?.method === "PATCH") {
        patchedUrls.push(url);
        return Promise.resolve(jsonResponse({ ...pipelineTwo, revision: 2, parseRunId: "parse-reparsed", chunkRunId: null, embeddingRunId: null }));
      }
      if (url.includes("/parse-runs/") || url.includes("/chunk-runs/") || url.includes("/embedding-runs/")) return new Promise<Response>(() => undefined);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1"));
    fireEvent.click(screen.getByRole("button", { name: "Reparse document" }));
    await waitFor(() => expect(finishReparse).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "Select pipeline two" }));
    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-2"));

    finishReparse(jsonResponse({ ...parseResult("document-old", "parse-reparsed", "lesson.pdf", "Reparsed"), id: "parse-reparsed" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(patchedUrls).toEqual([]);
    expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-2");
    expect(screen.getByTestId("selected-chunk")).toHaveTextContent("chunk-alt");
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("embedding-alt");
  });

  it("resumes a timed-out reparse in its original pipeline scope instead of the newly active one", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:document:test-user:document-old", "pipeline-1");
    const detail = selectableLineageSummary();
    const pipelineOne = namedPipeline("pipeline-1");
    const pipelineTwo = namedPipeline("pipeline-2", { chunkRunId: "chunk-alt", embeddingRunId: "embedding-alt" });
    let parsePolls = 0;
    const patchedUrls: string[] = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return Promise.resolve(jsonResponse(capabilities));
      if (url.endsWith("/documents")) return Promise.resolve(jsonResponse({ items: [persistedDocument()] }));
      if (url.endsWith("/documents/document-old/summary")) return Promise.resolve(jsonResponse(detail));
      if (url.endsWith("/documents/document-old/pipelines")) return Promise.resolve(jsonResponse([pipelineOne, pipelineTwo]));
      if (url.endsWith("/documents/document-old/parse") && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ id: "parse-reparsed", documentId: "document-old", status: "queued", progress: 0 }, 202));
      }
      if (url.includes("/parse-runs/parse-reparsed")) {
        parsePolls += 1;
        // First tracking pass ends like the 15-minute browser timeout; resuming finds the run completed.
        if (parsePolls === 1) return Promise.resolve(jsonResponse({ error: { code: "parse_poll_timeout", message: "Tracking paused." } }, 409));
        return Promise.resolve(jsonResponse({ ...parseResult("document-old", "parse-reparsed", "lesson.pdf", "Reparsed"), id: "parse-reparsed" }));
      }
      // Pipeline two's own parse is complete, so a resume that tracked it would also reach a PATCH.
      if (url.includes("/parse-runs/document-old-parse")) {
        return Promise.resolve(jsonResponse({ ...parseResult("document-old", "document-old-parse", "lesson.pdf", "Pipeline two parse"), id: "document-old-parse" }));
      }
      if (init?.method === "PATCH") {
        patchedUrls.push(url);
        return Promise.resolve(jsonResponse({ ...pipelineTwo, revision: 2, parseRunId: "parse-reparsed", chunkRunId: null, embeddingRunId: null }));
      }
      if (url.includes("/parse-runs/") || url.includes("/chunk-runs/") || url.includes("/embedding-runs/")) return new Promise<Response>(() => undefined);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1"));
    fireEvent.click(screen.getByRole("button", { name: "Reparse document" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/documents/document-old/parse") && init?.method === "POST")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Select pipeline two" }));
    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-2"));
    // The first status read waits one poll interval (1 s) after the queued response, then times out.
    await waitFor(() => expect(parsePolls).toBe(1), { timeout: 3_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    fireEvent.click(screen.getByRole("button", { name: "Resume parse tracking" }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Resume commits nothing to pipeline two and follows the run that timed out.
    expect(patchedUrls).toEqual([]);
    expect(parsePolls).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-2");
    expect(screen.getByTestId("selected-chunk")).toHaveTextContent("chunk-alt");
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("embedding-alt");
  });

  it("keeps use screens on the selected parse after a historical parse was inspected", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:document:test-user:document-old", "pipeline-1");
    navigationState.pathname = "/parse";
    const detail = selectableLineageSummary();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/capabilities")) return Promise.resolve(jsonResponse(capabilities));
      if (url.endsWith("/documents")) return Promise.resolve(jsonResponse({ items: [persistedDocument()] }));
      if (url.endsWith("/documents/document-old/summary")) return Promise.resolve(jsonResponse(detail));
      if (url.endsWith("/documents/document-old/pipelines")) return Promise.resolve(jsonResponse([namedPipeline("pipeline-1")]));
      if (url.endsWith("/parse-runs/document-old-parse")) return Promise.resolve(jsonResponse(parseResult("document-old", "document-old-parse", "lesson.pdf", "Current parse")));
      if (url.endsWith("/parse-runs/parse-old")) return Promise.resolve(jsonResponse(parseResult("document-old", "parse-old", "lesson.pdf", "Historical parse")));
      if (url.includes("/evaluation/datasets") || url.includes("/experiments")) return Promise.resolve(jsonResponse({ items: [] }));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = renderProbe();

    await waitFor(() => expect(screen.getByTestId("selected-parse-result")).toHaveTextContent("document-old-parse"));
    fireEvent.click(screen.getByRole("button", { name: "Select historical parse" }));
    await waitFor(() => expect(screen.getByTestId("viewed-parse-result")).toHaveTextContent("parse-old"));
    expect(screen.getByTestId("selected-parse-result")).toHaveTextContent("document-old-parse");

    navigationState.pathname = "/evaluation";
    view.rerender(<DocumentPipelineProvider><Probe /></DocumentPipelineProvider>);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("selected-parse")).toHaveTextContent("document-old-parse");
    expect(screen.getByTestId("selected-parse-result")).toHaveTextContent("document-old-parse");
  });

  it("reports a neutral loading workspace until the active document lineage is resolved", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    let finishSummary!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/capabilities")) return Promise.resolve(jsonResponse(capabilities));
      if (url.endsWith("/documents")) return Promise.resolve(jsonResponse({ items: [persistedDocument()] }));
      if (url.endsWith("/documents/document-old/pipelines")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/documents/document-old/summary")) return new Promise<Response>((resolve) => { finishSummary = resolve; });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    expect(screen.getByTestId("workspace-status")).toHaveTextContent("loading");
    await waitFor(() => expect(finishSummary).toBeTypeOf("function"));
    expect(screen.getByTestId("workspace-status")).toHaveTextContent("loading");
    finishSummary(jsonResponse(summaryDocument("document-old", "lesson.pdf")));
    await waitFor(() => expect(screen.getByTestId("workspace-status")).toHaveTextContent("ready"));
  });

  it("describes when a reparse would clear the selected downstream lineage", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:document:test-user:document-old", "pipeline-1");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/capabilities")) return Promise.resolve(jsonResponse(capabilities));
      if (url.endsWith("/documents")) return Promise.resolve(jsonResponse({ items: [persistedDocument()] }));
      if (url.endsWith("/documents/document-old/summary")) return Promise.resolve(jsonResponse(selectableLineageSummary()));
      if (url.endsWith("/documents/document-old/pipelines")) return Promise.resolve(jsonResponse([namedPipeline("pipeline-1")]));
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("reparse-impact")).toHaveTextContent("pipeline:true"));
  });

  it("drops a late rename conflict reload after the document changed", async () => {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:document:test-user:document-old", "pipeline-1");
    const oldPipeline = namedPipeline("pipeline-1");
    const newPipeline = { ...namedPipeline("pipeline-new"), documentId: "document-new", name: "New doc pipeline", parseRunId: "document-new-parse", chunkRunId: null, embeddingRunId: null };
    let oldListCalls = 0;
    let finishConflictList!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return Promise.resolve(jsonResponse(capabilities));
      if (url.endsWith("/documents")) return Promise.resolve(jsonResponse({ items: [persistedDocument(), { ...persistedDocument(), id: "document-new", fileName: "new.pdf" }] }));
      if (url.endsWith("/documents/document-old/summary")) return Promise.resolve(jsonResponse(selectableLineageSummary()));
      if (url.endsWith("/documents/document-new/summary")) return Promise.resolve(jsonResponse(summaryDocument("document-new", "new.pdf")));
      if (url.endsWith("/documents/document-new/pipelines")) return Promise.resolve(jsonResponse([newPipeline]));
      if (url.endsWith("/documents/document-old/pipelines")) {
        oldListCalls += 1;
        if (oldListCalls === 1) return Promise.resolve(jsonResponse([oldPipeline]));
        return new Promise<Response>((resolve) => { finishConflictList = resolve; });
      }
      if (url.endsWith("/document-pipelines/pipeline-1") && init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({ error: { code: "pipeline_conflict", message: "Stale revision" } }, 409));
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-pipeline")).toHaveTextContent("pipeline-1"));
    fireEvent.click(screen.getByRole("button", { name: "Rename pipeline one" }));
    await waitFor(() => expect(finishConflictList).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "Switch to new" }));
    await waitFor(() => expect(screen.getByTestId("pipeline-names")).toHaveTextContent("document-new/New doc pipeline"));

    finishConflictList(jsonResponse([{ ...oldPipeline, revision: 2 }]));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.getByTestId("pipeline-names")).toHaveTextContent("document-new/New doc pipeline");
    expect(screen.getByTestId("pipeline-names")).not.toHaveTextContent("document-old");
    expect(screen.getByTestId("persistence-error")).toHaveTextContent("none");
  });
});

describe("Accepted (202) embedding runs", () => {
  function setupAcceptedEmbedding() {
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
    localStorage.setItem("rag-steplab-active-pipeline-id:test-user", "pipeline-1");
    const pipeline = namedPipeline("pipeline-1", { embeddingRunId: null });
    const accepted = {
      id: "embedding-accepted",
      status: "queued",
      documentId: "document-old",
      chunkRunId: "chunk-new",
      model: "gemini",
      dimensions: 768,
      embeddingFormatVersion: "v1",
      embeddingCount: 0,
      upstream: { chunkRunId: "chunk-new" },
    };
    const state = { completed: false };
    let resolvePoll!: (payload: unknown) => void;
    const poll = new Promise<unknown>((resolve) => { resolvePoll = resolve; });
    const patchBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
      if (url.endsWith("/capabilities")) return respond(capabilities);
      if (url.endsWith("/documents")) return respond({ items: [persistedDocument()] });
      if (url.endsWith("/documents/document-old/summary")) {
        const summary = selectableLineageSummary();
        return respond(state.completed
          ? { ...summary, embeddingRuns: [...summary.embeddingRuns, { id: "embedding-accepted", status: "completed", isCompatible: true, upstream: { chunkRunId: "chunk-new" } }] }
          : summary);
      }
      if (url.endsWith("/documents/document-old/pipelines")) return respond([pipeline]);
      if (url.endsWith("/documents/document-old/embeddings") && init?.method === "POST") return respond(accepted, 202);
      if (url.endsWith("/embedding-runs/embedding-accepted")) return poll.then((payload) => new Response(JSON.stringify(payload), { status: 200 }));
      if (url.endsWith("/document-pipelines/pipeline-1") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patchBodies.push(body);
        return respond({ ...pipeline, revision: 2, embeddingRunId: body.embeddingRunId });
      }
      if (url.includes("/chunk-runs/")) return new Promise<Response>(() => undefined);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return { accepted, fetchMock, patchBodies, resolvePoll, state };
  }

  it("polls an accepted embedding run and records it in the pipeline only after it completes", async () => {
    const { accepted, fetchMock, patchBodies, resolvePoll, state } = setupAcceptedEmbedding();
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("selected-chunk")).toHaveTextContent("chunk-new"));
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("none");

    fireEvent.click(screen.getByRole("button", { name: "Run embedding" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/embedding-runs/embedding-accepted"))).toBe(true), { timeout: 3_000 });
    expect(patchBodies).toHaveLength(0);
    expect(screen.getByTestId("embedding-status")).toHaveTextContent("processing:none");
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("none");

    state.completed = true;
    resolvePoll({ ...accepted, status: "completed", embeddingCount: 1 });
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toMatchObject({ embeddingRunId: "embedding-accepted" });
    await waitFor(() => expect(screen.getByTestId("selected-embedding")).toHaveTextContent("embedding-accepted"));
    expect(screen.getByTestId("embedding-status")).toHaveTextContent("completed:none");
  });

  it("surfaces a failed accepted embedding run without recording it", async () => {
    const { accepted, patchBodies, resolvePoll } = setupAcceptedEmbedding();
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("selected-chunk")).toHaveTextContent("chunk-new"));

    fireEvent.click(screen.getByRole("button", { name: "Run embedding" }));
    resolvePoll({ ...accepted, status: "failed", errorCode: "worker_terminated", errorMessage: "The worker stopped." });
    await waitFor(() => expect(screen.getByTestId("embedding-status")).toHaveTextContent("error:worker_terminated"), { timeout: 3_000 });
    expect(patchBodies).toHaveLength(0);
    expect(screen.getByTestId("selected-embedding")).toHaveTextContent("none");
  });
});
