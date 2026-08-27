import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentsScreen } from "@/components/documents-screen";
import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { OverviewScreen } from "@/components/overview-screen";
import { PreferencesProvider } from "@/components/preferences-provider";

const capabilities = { embeddingModel: "gemini", embeddingDimensions: 768, generationModel: "gemini", rerankModel: "gemini", judgeModel: "gemini", embeddingFormatVersion: "v1", limits: {} };

function renderWithPipeline(node: React.ReactNode) {
  return render(<PreferencesProvider><DocumentPipelineProvider>{node}</DocumentPipelineProvider></PreferencesProvider>);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Phase 6B document ownership", () => {
  it("shows workspace controls and the Figma-first journey without upload or parse actions", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const payload = url.endsWith("/capabilities") ? capabilities : { items: [] };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithPipeline(<OverviewScreen />);

    expect(screen.getByRole("heading", { name: "Build your RAG, one step at a time." })).toBeInTheDocument();
    expect(screen.getByTestId("workspace-control-plane")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-lineage")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New pipeline" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Rename" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Delete" })).toBeVisible();
    expect(screen.getByTestId("continue-surface")).toBeInTheDocument();
    expect(screen.queryByTestId("current-setup")).not.toBeInTheDocument();
    expect(screen.getByTestId("overview-journey-compact")).toContainElement(screen.getAllByText("Build Context")[1]);
    expect(screen.getAllByText("Retrieval").length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(screen.getByText(/No documents yet/)).toBeInTheDocument());
    expect(screen.getByTestId("overview-continue-action")).toHaveAttribute("href", "/documents");
    expect(screen.getByTestId("overview-continue-action")).toHaveTextContent("Select a document");
    expect(screen.queryByRole("button", { name: /Add PDF|Choose PDF|Parse Document|Reparse/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("activity-timeline")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/documents/"))).toBe(false);
  });

  it("uploads from the clickable drop zone without parsing", async () => {
    const user = userEvent.setup();
    const documentItem = { id: "document-1", fileName: "lesson.pdf", mediaType: "application/pdf", sizeBytes: 8, pageCount: 0, sha256: "sha", activeParseRunId: null, activeChunkRunId: null, activeEmbeddingRunId: null, createdAt: null, updatedAt: null };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      let payload: unknown = url.endsWith("/capabilities") ? capabilities : { items: [] };
      let status = 200;
      if (url.endsWith("/documents") && init?.method === "POST") {
        payload = { document: documentItem, reusedDocument: false };
        status = 201;
      } else if (url.endsWith("/documents/document-1/summary")) {
        payload = { ...documentItem, parseRuns: [], chunkRuns: [], embeddingRuns: [], experiments: [], evaluationDatasets: [] };
      }
      return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithPipeline(<DocumentsScreen />);

    expect(screen.queryByRole("button", { name: "Add PDF" })).not.toBeInTheDocument();
    expect(screen.getByTestId("pdf-drop-zone")).toHaveAttribute("type", "button");
    const input = screen.getByLabelText("Choose PDF");
    await user.upload(input, new File(["%PDF-1.4"], "lesson.pdf", { type: "application/pdf" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, request]) => String(url).endsWith("/documents") && (request as RequestInit | undefined)?.method === "POST")).toBe(true));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/documents/parse"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/parse-runs"))).toBe(false);
  });

  it("keeps an upload error visible and allows retry from the same surface", async () => {
    const user = userEvent.setup();
    const documentItem = { id: "document-2", fileName: "retry.pdf", mediaType: "application/pdf", sizeBytes: 8, pageCount: 0, sha256: "retry-sha", activeParseRunId: null, activeChunkRunId: null, activeEmbeddingRunId: null, createdAt: null, updatedAt: null };
    let uploadAttempts = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/documents") && init?.method === "POST") {
        uploadAttempts += 1;
        if (uploadAttempts === 1) {
          return Promise.resolve(new Response(JSON.stringify({ error: { code: "storage_unavailable", message: "Upload failed. Try again." } }), { status: 503, headers: { "Content-Type": "application/json" } }));
        }
        return Promise.resolve(new Response(JSON.stringify({ document: documentItem, reusedDocument: false }), { status: 201, headers: { "Content-Type": "application/json" } }));
      }
      const payload = url.endsWith("/capabilities") ? capabilities : url.endsWith("/documents/document-2/summary") ? { ...documentItem, parseRuns: [], chunkRuns: [], embeddingRuns: [], experiments: [], evaluationDatasets: [] } : { items: [] };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithPipeline(<DocumentsScreen />);

    const input = screen.getByLabelText("Choose PDF");
    const file = new File(["%PDF-1.4"], "retry.pdf", { type: "application/pdf" });
    await user.upload(input, file);
    expect(await screen.findByRole("alert")).toHaveTextContent("Upload failed. Try again.");
    expect(screen.getByText("retry.pdf", { exact: false })).toBeInTheDocument();

    await user.upload(input, file);
    await waitFor(() => expect(uploadAttempts).toBe(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("accepts a valid PDF through the real drop zone", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/documents") && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ document: { id: "document-drop", fileName: "drop.pdf", mediaType: "application/pdf", sizeBytes: 8, pageCount: 0, sha256: "drop", activeParseRunId: null, activeChunkRunId: null, activeEmbeddingRunId: null, createdAt: null, updatedAt: null }, reusedDocument: false }), { status: 201, headers: { "Content-Type": "application/json" } }));
      }
      const payload = url.endsWith("/capabilities") ? capabilities : url.endsWith("/documents/document-drop/summary") ? { id: "document-drop", fileName: "drop.pdf", mediaType: "application/pdf", sizeBytes: 8, pageCount: 0, activeParseRunId: null, activeChunkRunId: null, activeEmbeddingRunId: null, parseRuns: [], chunkRuns: [], embeddingRuns: [], experiments: [], evaluationDatasets: [] } : { items: [] };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithPipeline(<DocumentsScreen />);
    const file = new File(["%PDF-1.4"], "drop.pdf", { type: "application/pdf" });
    const dropEvent = new Event("drop", { bubbles: true });
    Object.defineProperty(dropEvent, "dataTransfer", { value: { files: [file] } });
    fireEvent(screen.getByTestId("pdf-drop-zone"), dropEvent);
    expect(await screen.findByRole("status")).toHaveTextContent("Document added");
  });
});
