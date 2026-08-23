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
  const activeParse = parseResult("document-old", "parse-new", "lesson.pdf", "Current parse");
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
    activeParseRun: activeParse,
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

function Probe() {
  const {
    activeDocument,
    activeDocumentId,
    pendingUpload,
    persistenceError,
    selectedParseRunId,
    selectedChunkRunId,
    selectFile,
    selectParseRun,
    selectPersistedDocument,
  } = useDocumentPipeline();

  return (
    <div>
      <output data-testid="active-document">{activeDocument?.id ?? "none"}</output>
      <output data-testid="active-document-id">{activeDocumentId ?? "none"}</output>
      <output data-testid="pending-upload">{pendingUpload?.name ?? "none"}</output>
      <output data-testid="selected-parse">{selectedParseRunId ?? "none"}</output>
      <output data-testid="selected-chunk">{selectedChunkRunId ?? "none"}</output>
      <output data-testid="artifact-count">{activeDocument?.chunkRuns.length ?? 0}</output>
      <output data-testid="persistence-error">{persistenceError?.code ?? "none"}</output>
      <button onClick={() => selectFile(new File(["%PDF-1.4"], "pending.pdf", { type: "application/pdf" }))} type="button">Select pending upload</button>
      <button onClick={() => void selectPersistedDocument("document-new")} type="button">Switch to new</button>
      <button onClick={() => void selectPersistedDocument("document-old")} type="button">Switch to old</button>
      <button onClick={() => void selectParseRun("parse-old")} type="button">Select historical parse</button>
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
    if (url.endsWith("/documents/document-old")) return respond(detail);
    if (url.endsWith("/documents/document-new")) {
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
    fireEvent.click(screen.getByRole("button", { name: "Select historical parse" }));
    await waitFor(() => expect(screen.getByTestId("selected-parse")).toHaveTextContent("parse-old"));
    expect(pipelineListCalls).toBe(2);
    expect(patchBodies.map((body) => body.expectedRevision)).toEqual([1, 2]);
  });

  it("keeps the committed document while a different file is only pending", async () => {
    setupFetch();
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-document")).toHaveTextContent("document-old"));
    fireEvent.click(screen.getByRole("button", { name: "Select pending upload" }));

    expect(screen.getByTestId("active-document")).toHaveTextContent("document-old");
    expect(screen.getByTestId("pending-upload")).toHaveTextContent("pending.pdf");
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
    fireEvent.click(screen.getByRole("button", { name: "Switch to new" }));

    await waitFor(() => expect(screen.getByTestId("persistence-error")).toHaveTextContent("document_unavailable"));
    expect(screen.getByTestId("active-document")).toHaveTextContent("document-old");
  });

  it("ignores a late switch response and preserves compatible historical selections per document", async () => {
    setupFetch({ newDocumentMode: "delayed" });
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

    view.unmount();
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("selected-parse")).toHaveTextContent("parse-old"));
    expect(screen.getByTestId("selected-chunk")).toHaveTextContent("none");
  });
});
