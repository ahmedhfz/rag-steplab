import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentPipelineProvider, useDocumentPipeline } from "@/components/document-pipeline-provider";

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

function Probe() {
  const {
    activeDocument,
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

function setupFetch({ newDocumentMode = "error" as "error" | "delayed" } = {}) {
  localStorage.setItem("rag-steplab-active-document-id:test-user", "document-old");
  const detail = documentDetail();
  const oldParse = parseResult("document-old", "parse-old", "lesson.pdf", "Historical parse");
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const respond = (payload: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
    if (url.endsWith("/capabilities")) return respond(capabilities);
    if (url.endsWith("/documents")) return respond({ items: [persistedDocument(), { ...persistedDocument(), id: "document-new", fileName: "new.pdf" }] });
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
  vi.restoreAllMocks();
});

describe("Document pipeline committed state", () => {
  it("keeps the committed document while a different file is only pending", async () => {
    setupFetch();
    renderProbe();

    await waitFor(() => expect(screen.getByTestId("active-document")).toHaveTextContent("document-old"));
    fireEvent.click(screen.getByRole("button", { name: "Select pending upload" }));

    expect(screen.getByTestId("active-document")).toHaveTextContent("document-old");
    expect(screen.getByTestId("pending-upload")).toHaveTextContent("pending.pdf");
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
