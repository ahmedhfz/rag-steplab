import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { OverviewScreen } from "@/components/overview-screen";
import { PreferencesProvider } from "@/components/preferences-provider";

function renderOverview() {
  return render(
    <PreferencesProvider>
      <DocumentPipelineProvider><OverviewScreen /></DocumentPipelineProvider>
    </PreferencesProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Overview PDF selection", () => {
  it("selects and removes a PDF without starting parsing automatically", async () => {
    const user = userEvent.setup();
    renderOverview();
    const input = screen.getByLabelText("Choose PDF");
    const file = new File(["%PDF-1.4"], "learning-notes.pdf", { type: "application/pdf" });

    await user.upload(input, file);

    expect(await screen.findByText("learning-notes.pdf")).toBeInTheDocument();
    expect(screen.getAllByText("Document selected").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Parse Document" })).toBeEnabled();
    expect(screen.getByText("Click Parse Document to start the real FastAPI → Docling request.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove selected document" }));

    await waitFor(() => expect(screen.queryByText("learning-notes.pdf")).not.toBeInTheDocument());
    expect(await screen.findByText("No document selected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose PDF" })).toHaveFocus();
  });

  it("sends the selected PDF and renders the real parse lifecycle", async () => {
    const user = userEvent.setup();
    const completedParse = {
      document: { fileName: "learning-notes.pdf", mediaType: "application/pdf", sizeBytes: 9, pageCount: 1 },
      structured: {
        pages: [{ pageNumber: 1, elements: [{ id: "element-1", type: "heading", pageNumbers: [1], text: "Lesson", level: 1, table: null }] }],
        elements: [{ id: "element-1", type: "heading", pageNumbers: [1], text: "Lesson", level: 1, table: null }],
      },
      markdown: "# Lesson",
      summary: { pageCount: 1, headingCount: 1, paragraphCount: 0, listCount: 0, tableCount: 0 },
      documentId: "document-1",
      parseRunId: "parse-1",
      status: "completed",
      runMetadata: { parser: "docling" },
    };
    const parseAccepted = { documentId: "document-1", parseRunId: "parse-1", status: "queued" };
    let parsePollCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const payload = url.endsWith("/capabilities")
        ? { embeddingModel: "gemini-embedding-001", embeddingDimensions: 3072, generationModel: "gemini", rerankModel: "gemini", judgeModel: "gemini", embeddingFormatVersion: "v1", limits: {} }
        : url.endsWith("/documents") && init?.method !== "POST" ? { documents: [] }
          : url.endsWith("/documents/parse") && init?.method === "POST" ? parseAccepted
            : url.endsWith("/parse-runs/parse-1") ? (parsePollCount++ === 0 ? { id: "parse-1", documentId: "document-1", status: "running" } : completedParse)
              : { documents: [] };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: url.endsWith("/documents/parse") ? 202 : 200, headers: { "Content-Type": "application/json" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderOverview();
    const input = screen.getByLabelText("Choose PDF");
    const file = new File(["%PDF-1.4"], "learning-notes.pdf", { type: "application/pdf" });

    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "Parse Document" }));

    await waitFor(() => expect(screen.getByText("Parse completed")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/documents/parse", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    expect(screen.getByText("Pages")).toBeInTheDocument();
    expect(screen.getByText("Parse completed. You can inspect the returned content or run parsing again.")).toBeInTheDocument();
    expect(screen.getByTestId("activity-timeline")).toHaveAttribute("data-state", "completed");
    expect(screen.getByTestId("activity-timeline").querySelector('[data-activity-type="parseCompleted"]')).toHaveAttribute("data-activity-status", "completed");
  });

  it("renders queued and running states and guards duplicate submits", async () => {
    const user = userEvent.setup();
    const completedParse = {
      document: { fileName: "queued.pdf", mediaType: "application/pdf", sizeBytes: 9, pageCount: 1 },
      structured: { pages: [{ pageNumber: 1, elements: [] }], elements: [] },
      markdown: "# Queued",
      summary: { pageCount: 1, headingCount: 0, paragraphCount: 0, listCount: 0, tableCount: 0 },
      documentId: "document-queued",
      parseRunId: "parse-queued",
      status: "completed",
    };
    let postCount = 0;
    let pollCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return Promise.resolve(new Response(JSON.stringify({ embeddingModel: "gemini", embeddingDimensions: 768, generationModel: "gemini", rerankModel: "gemini", judgeModel: "gemini", embeddingFormatVersion: "v1", limits: {} }), { status: 200 }));
      if (url.endsWith("/documents") && init?.method !== "POST") return Promise.resolve(new Response(JSON.stringify({ documents: [] }), { status: 200 }));
      if (url.endsWith("/documents/parse") && init?.method === "POST") {
        postCount += 1;
        return Promise.resolve(new Response(JSON.stringify({ documentId: "document-queued", parseRunId: "parse-queued", status: "queued" }), { status: 202 }));
      }
      if (url.endsWith("/parse-runs/parse-queued")) {
        pollCount += 1;
        return Promise.resolve(new Response(JSON.stringify(pollCount === 1
          ? { id: "parse-queued", documentId: "document-queued", status: "running" }
          : completedParse), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderOverview();
    await user.upload(screen.getByLabelText("Choose PDF"), new File(["%PDF-1.4"], "queued.pdf", { type: "application/pdf" }));
    const parseButton = screen.getByRole("button", { name: "Parse Document" });

    await user.click(parseButton);
    expect(parseButton).toBeDisabled();
    expect(screen.getByTestId("activity-timeline")).toHaveAttribute("data-state", "queued");
    fireEvent.click(parseButton);
    expect(postCount).toBe(1);

    await waitFor(() => expect(screen.getByTestId("activity-timeline")).toHaveAttribute("data-state", "running"));
    await waitFor(() => expect(screen.getByTestId("activity-timeline")).toHaveAttribute("data-state", "completed"));
  });

  it("keeps polling through a temporary network failure and recovers", async () => {
    const user = userEvent.setup();
    const completedParse = {
      document: { fileName: "recovery.pdf", mediaType: "application/pdf", sizeBytes: 9, pageCount: 1 },
      structured: { pages: [{ pageNumber: 1, elements: [] }], elements: [] },
      markdown: "# Recovery",
      summary: { pageCount: 1, headingCount: 0, paragraphCount: 0, listCount: 0, tableCount: 0 },
      documentId: "document-recovery",
      parseRunId: "parse-recovery",
      status: "completed",
    };
    let pollCount = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return Promise.resolve(new Response(JSON.stringify({ embeddingModel: "gemini", embeddingDimensions: 768, generationModel: "gemini", rerankModel: "gemini", judgeModel: "gemini", embeddingFormatVersion: "v1", limits: {} }), { status: 200 }));
      if (url.endsWith("/documents") && init?.method !== "POST") return Promise.resolve(new Response(JSON.stringify({ documents: [] }), { status: 200 }));
      if (url.endsWith("/documents/parse")) return Promise.resolve(new Response(JSON.stringify({ documentId: "document-recovery", parseRunId: "parse-recovery", status: "queued" }), { status: 202 }));
      if (url.endsWith("/parse-runs/parse-recovery")) {
        pollCount += 1;
        if (pollCount === 1) return Promise.reject(new Error("temporary offline"));
        return Promise.resolve(new Response(JSON.stringify(pollCount === 2
          ? { id: "parse-recovery", documentId: "document-recovery", status: "running" }
          : completedParse), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderOverview();
    await user.upload(screen.getByLabelText("Choose PDF"), new File(["%PDF-1.4"], "recovery.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Parse Document" }));

    await waitFor(() => expect(screen.getByText("Parse completed")).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByTestId("activity-timeline")).toHaveAttribute("data-state", "completed");
    expect(pollCount).toBeGreaterThanOrEqual(3);
  });

  it("resumes an in-flight reparse after refresh without replacing the old active lineage early", async () => {
    localStorage.setItem("rag-steplab-active-document-id", "document-refresh");
    const parsed = (parseRunId: string, heading: string) => ({
      document: { id: "document-refresh", fileName: "refresh.pdf", mediaType: "application/pdf", sizeBytes: 9, pageCount: 1 },
      structured: {
        pages: [{ pageNumber: 1, elements: [{ id: `element-${parseRunId}`, type: "heading", pageNumbers: [1], text: heading, level: 1, table: null }] }],
        elements: [{ id: `element-${parseRunId}`, type: "heading", pageNumbers: [1], text: heading, level: 1, table: null }],
      },
      markdown: `# ${heading}`,
      summary: { pageCount: 1, headingCount: 1, paragraphCount: 0, listCount: 0, tableCount: 0 },
      documentId: "document-refresh",
      parseRunId,
      status: "completed",
    });
    const oldParse = parsed("parse-old", "Old active result");
    const newParse = parsed("parse-new", "New completed result");
    let workerCompleted = false;
    let pollCount = 0;
    const documentPayload = () => ({
      id: "document-refresh",
      fileName: "refresh.pdf",
      mediaType: "application/pdf",
      sizeBytes: 9,
      pageCount: 1,
      activeParseRunId: workerCompleted ? "parse-new" : "parse-old",
      activeChunkRunId: null,
      activeEmbeddingRunId: null,
      parseRuns: workerCompleted
        ? [{ id: "parse-new", status: "completed" }, { id: "parse-old", status: "completed" }]
        : [{ id: "parse-new", status: "running" }, { id: "parse-old", status: "completed" }],
      chunkRuns: [],
      embeddingRuns: [],
      experiments: [],
      activeParseRun: workerCompleted ? newParse : oldParse,
    });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/capabilities")) return Promise.resolve(new Response(JSON.stringify({ embeddingModel: "gemini", embeddingDimensions: 768, generationModel: "gemini", rerankModel: "gemini", judgeModel: "gemini", embeddingFormatVersion: "v1", limits: {} }), { status: 200 }));
      if (url.endsWith("/documents")) return Promise.resolve(new Response(JSON.stringify({ items: [documentPayload()] }), { status: 200 }));
      if (url.endsWith("/documents/document-refresh")) return Promise.resolve(new Response(JSON.stringify(documentPayload()), { status: 200 }));
      if (url.includes("/experiments") || url.includes("/evaluation/datasets")) return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      if (url.endsWith("/parse-runs/parse-new")) {
        pollCount += 1;
        workerCompleted = true;
        return Promise.resolve(new Response(JSON.stringify(newParse), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderOverview();

    await waitFor(() => expect(pollCount).toBeGreaterThan(0), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText("Parse completed")).toBeInTheDocument(), { timeout: 3000 });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/parse-runs/parse-new", expect.any(Object));
  });

  it("maps interrupted backend runs to failed with parse_interrupted copy", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return Promise.resolve(new Response(JSON.stringify({ embeddingModel: "gemini", embeddingDimensions: 768, generationModel: "gemini", rerankModel: "gemini", judgeModel: "gemini", embeddingFormatVersion: "v1", limits: {} }), { status: 200 }));
      if (url.endsWith("/documents") && init?.method !== "POST") return Promise.resolve(new Response(JSON.stringify({ documents: [] }), { status: 200 }));
      if (url.endsWith("/documents/parse")) return Promise.resolve(new Response(JSON.stringify({ documentId: "document-interrupted", parseRunId: "parse-interrupted", status: "queued" }), { status: 202 }));
      if (url.endsWith("/parse-runs/parse-interrupted")) return Promise.resolve(new Response(JSON.stringify({ id: "parse-interrupted", documentId: "document-interrupted", status: "interrupted" }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderOverview();
    await user.upload(screen.getByLabelText("Choose PDF"), new File(["%PDF-1.4"], "interrupted.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Parse Document" }));

    await waitFor(() => expect(screen.getByTestId("activity-timeline")).toHaveAttribute("data-state", "error"));
    expect(screen.getAllByText("The parse worker stopped before the document was completed. Try parsing again.").length).toBeGreaterThan(0);
    expect(screen.getByText("No parse summary is available until a backend parser returns structured content.")).toBeInTheDocument();
  });

  it("shows a backend-unavailable error without inventing parse data", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderOverview();
    const input = screen.getByLabelText("Choose PDF");
    const file = new File(["%PDF-1.4"], "offline.pdf", { type: "application/pdf" });

    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "Parse Document" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The RAG backend could not be reached.");
    expect(screen.getByText("Parse failed")).toBeInTheDocument();
    expect(screen.getByText("No parse summary is available until a backend parser returns structured content.")).toBeInTheDocument();
    expect(screen.getByTestId("activity-timeline")).toHaveAttribute("data-state", "error");
    expect(screen.getByTestId("activity-timeline").querySelector('[data-activity-type="parseFailed"]')).toHaveAttribute("data-activity-status", "error");
  });

  it("rejects an invalid local file with a visible validation error", () => {
    renderOverview();
    const input = screen.getByLabelText("Choose PDF");
    const file = new File(["plain text"], "notes.txt", { type: "text/plain" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByRole("alert")).toHaveTextContent("Only PDF files are supported.");
    expect(screen.getByText("No document selected.")).toBeInTheDocument();
  });

  it("supports drag-active feedback and PDF drop selection", async () => {
    renderOverview();
    const dropZone = screen.getByRole("group", { name: "Upload Document" });
    const file = new File(["%PDF-1.4"], "dropped.pdf", { type: "application/pdf" });

    fireEvent.dragEnter(dropZone, { dataTransfer: { files: [file] } });
    expect(dropZone).toHaveAttribute("data-state", "drag-active");

    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByText("dropped.pdf")).toBeInTheDocument());
    expect(dropZone).toHaveAttribute("data-state", "idle");
  });
});
