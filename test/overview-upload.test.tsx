import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("Overview document ownership", () => {
  it("shows a useful first step and the Journey before the first document", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const payload = url.endsWith("/capabilities") ? capabilities : { items: [] };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithPipeline(<OverviewScreen />);

    expect(screen.getByRole("heading", { name: "Build your RAG, one step at a time." })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("overview-first-use")).toBeInTheDocument());
    expect(screen.queryByTestId("workspace-control-plane")).not.toBeInTheDocument();
    expect(screen.queryByTestId("overview-lineage")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try a sample PDF" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Add your own PDF" })).toHaveAttribute("href", "/documents");
    // The privacy warning is shortened to one sentence, never removed.
    expect(screen.getByTestId("overview-privacy-note")).toHaveTextContent("The sample is fictional. Don't upload personal or confidential PDFs.");
    expect(screen.getByTestId("overview-first-use-steps")).toHaveTextContent(/Add a PDF.*Inspect each stage.*Get a sourced answer/);
    expect(screen.queryByTestId("current-setup")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("overview-journey-compact")).getByText("Context")).toBeInTheDocument();
    expect(screen.getAllByText("Retrieval").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId("overview-continue-action")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add PDF|Choose PDF|Parse Document|Reparse/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("activity-timeline")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/documents/"))).toBe(false);
  });

  it("uploads the shipped sample through the normal document endpoint without starting parsing", async () => {
    const user = userEvent.setup();
    const sample = { id: "sample-1", fileName: "rag-steplab-sample-city-bikes.pdf", mediaType: "application/pdf", sizeBytes: 100, pageCount: 0, sha256: "ee26ecb099d9a1fba771ce9b4f8e82664a4b6982e5dec7a638350fa1e3e7b8a7", activeParseRunId: null, activeChunkRunId: null, activeEmbeddingRunId: null, createdAt: null, updatedAt: null };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/samples/rag-steplab-sample-city-bikes.pdf") return Promise.resolve(new Response("%PDF-1.4 sample", { status: 200, headers: { "Content-Type": "application/pdf" } }));
      if (url.endsWith("/documents") && init?.method === "POST") return Promise.resolve(new Response(JSON.stringify({ document: sample, reusedDocument: false }), { status: 201 }));
      const payload = url.endsWith("/capabilities") ? capabilities : url.split("?")[0].endsWith("/documents/sample-1/summary") ? { ...sample, parseRuns: [], chunkRuns: [], embeddingRuns: [], experiments: [], evaluationDatasets: [] } : { items: [] };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithPipeline(<OverviewScreen />);
    await user.click(await screen.findByRole("button", { name: "Try a sample PDF" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, request]) => String(url).endsWith("/documents") && (request as RequestInit | undefined)?.method === "POST")).toBe(true));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/parse-runs"))).toBe(false);
    await waitFor(() => expect(screen.getByTestId("workspace-control-plane")).toBeInTheDocument());
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
      } else if (url.split("?")[0].endsWith("/documents/document-1/summary")) {
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
      const payload = url.endsWith("/capabilities") ? capabilities : url.split("?")[0].endsWith("/documents/document-2/summary") ? { ...documentItem, parseRuns: [], chunkRuns: [], embeddingRuns: [], experiments: [], evaluationDatasets: [] } : { items: [] };
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
      const payload = url.endsWith("/capabilities") ? capabilities : url.split("?")[0].endsWith("/documents/document-drop/summary") ? { id: "document-drop", fileName: "drop.pdf", mediaType: "application/pdf", sizeBytes: 8, pageCount: 0, activeParseRunId: null, activeChunkRunId: null, activeEmbeddingRunId: null, parseRuns: [], chunkRuns: [], embeddingRuns: [], experiments: [], evaluationDatasets: [] } : { items: [] };
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

  it("requires confirmation before deleting a persisted document and removes it from the library", async () => {
    const user = userEvent.setup();
    const documentItem = { id: "document-delete", fileName: "delete-me.pdf", mediaType: "application/pdf", sizeBytes: 8, pageCount: 1, sha256: "delete-sha", activeParseRunId: null, activeChunkRunId: null, activeEmbeddingRunId: null, latestParseStatus: "completed", latestParseError: null, createdAt: null, updatedAt: null };
    localStorage.setItem("rag-steplab-active-pipeline-id:document:test-user:document-delete", "pipeline-delete");
    localStorage.setItem("rag-steplab-lineage-selections-v1:test-user", JSON.stringify({ "document-delete": { selectedParseRunId: "parse-delete", selectedChunkRunId: null, selectedEmbeddingRunId: null } }));
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/documents/document-delete") && init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      const payload = url.endsWith("/capabilities") ? capabilities : { items: [documentItem] };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithPipeline(<DocumentsScreen />);

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Delete: delete-me.pdf" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Delete: delete-me.pdf" })[0]);
    const dialog = screen.getByTestId("delete-document-dialog");
    expect(dialog).toHaveTextContent("delete-me.pdf");
    expect(fetchMock.mock.calls.some(([url, request]) => String(url).endsWith("/documents/document-delete") && (request as RequestInit | undefined)?.method === "DELETE")).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, request]) => String(url).endsWith("/documents/document-delete") && (request as RequestInit | undefined)?.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.getByText("No documents yet.")).toBeInTheDocument());
    expect(screen.queryByTestId("delete-document-dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem("rag-steplab-active-pipeline-id:document:test-user:document-delete")).toBeNull();
    expect(JSON.parse(localStorage.getItem("rag-steplab-lineage-selections-v1:test-user") ?? "{}")).not.toHaveProperty("document-delete");
  });

  it("clears active lineage and selects the next document after deleting the active one", async () => {
    const user = userEvent.setup();
    const firstDocument = { id: "document-active", fileName: "active.pdf", mediaType: "application/pdf", sizeBytes: 8, pageCount: 1, sha256: "active-sha", activeParseRunId: null, activeChunkRunId: null, activeEmbeddingRunId: null, latestParseStatus: "completed", latestParseError: null, createdAt: null, updatedAt: null };
    const nextDocument = { ...firstDocument, id: "document-next", fileName: "next.pdf", sha256: "next-sha" };
    const summary = (document: typeof firstDocument) => ({ ...document, parseRuns: [], chunkRuns: [], embeddingRuns: [], experiments: [], evaluationDatasets: [], evaluationRuns: [] });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/documents/document-active") && init?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
      if (url.endsWith("/capabilities")) return Promise.resolve(new Response(JSON.stringify(capabilities), { status: 200 }));
      if (url.endsWith("/documents") && !init?.method) return Promise.resolve(new Response(JSON.stringify({ items: [firstDocument, nextDocument] }), { status: 200 }));
      if (url.split("?")[0].endsWith("/documents/document-active/summary")) return Promise.resolve(new Response(JSON.stringify(summary(firstDocument)), { status: 200 }));
      if (url.split("?")[0].endsWith("/documents/document-next/summary")) return Promise.resolve(new Response(JSON.stringify(summary(nextDocument)), { status: 200 }));
      if (url.endsWith("/documents/document-active/pipelines") || url.endsWith("/documents/document-next/pipelines")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithPipeline(<DocumentsScreen />);

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Select document: active.pdf" }).length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: "Select document: active.pdf" })[0]);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).split("?")[0].endsWith("/documents/document-active/summary"))).toBe(true));
    await user.click(screen.getAllByRole("button", { name: "Delete: active.pdf" })[0]);
    await user.click(within(screen.getByTestId("delete-document-dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.getAllByRole("button", { name: "Select document: next.pdf" }).length).toBeGreaterThan(0));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).split("?")[0].endsWith("/documents/document-next/summary"))).toBe(true));
    expect(screen.queryByText("active.pdf", { exact: true })).not.toBeInTheDocument();
  });
});
