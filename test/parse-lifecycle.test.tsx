import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentLibrary } from "@/components/document-library";
import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { DocumentsScreen } from "@/components/documents-screen";
import { ParseScreen } from "@/components/parse-screen";
import { PreferencesProvider } from "@/components/preferences-provider";

const capabilities = {
  embeddingModel: "gemini",
  embeddingDimensions: 768,
  generationModel: "gemini",
  rerankModel: "gemini",
  judgeModel: "gemini",
  embeddingFormatVersion: "v1",
  limits: {},
};

const documentItem = {
  id: "document-1",
  fileName: "lesson.pdf",
  mediaType: "application/pdf",
  sizeBytes: 128,
  pageCount: 0,
  sha256: "sha-1",
  activeParseRunId: null,
  activeChunkRunId: null,
  activeEmbeddingRunId: null,
  createdAt: null,
  updatedAt: null,
};

const parseResult = {
  document: { ...documentItem, pageCount: 1 },
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

function runSummary(status: "queued" | "running" | "completed" | "failed", error: { code: string; message: string } | null = null) {
  return {
    id: "parse-1",
    status,
    progress: status === "completed" ? 100 : status === "running" ? 40 : 0,
    isCompatible: status === "completed",
    isStale: false,
    historicalLineage: false,
    upstream: { documentId: "document-1" },
    config: {},
    timing: { startedAt: null, completedAt: null, durationMs: null },
    error,
  };
}

function summary(parseRuns: unknown[] = [], activeParseRunId: string | null = null) {
  return {
    ...documentItem,
    activeParseRunId,
    pageCount: activeParseRunId ? 1 : 0,
    parseRuns,
    chunkRuns: [],
    embeddingRuns: [],
    experiments: [],
    evaluationDatasets: [],
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
}

function renderScreen(node: React.ReactNode) {
  const testFetch = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith("/pipelines")
      ? jsonResponse([])
      : testFetch(input, init)));
  return render(<PreferencesProvider><DocumentPipelineProvider>{node}</DocumentPipelineProvider></PreferencesProvider>);
}

function prepareActiveDocument() {
  localStorage.setItem("rag-steplab-active-document-id:test-user", documentItem.id);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Parse ownership and lifecycle", () => {
  it("starts explicit Parse through the persisted endpoint and renders completed output", async () => {
    const user = userEvent.setup();
    prepareActiveDocument();
    let summaryCalls = 0;
    let pollCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return jsonResponse(capabilities);
      if (url.endsWith("/documents") && init?.method !== "POST") return jsonResponse({ items: [documentItem] });
      if (url.split("?")[0].endsWith("/documents/document-1/summary")) {
        summaryCalls += 1;
        return jsonResponse(summary(summaryCalls > 1 ? [runSummary("completed")] : [], summaryCalls > 1 ? "parse-1" : null));
      }
      if (url.endsWith("/documents/document-1/parse") && init?.method === "POST") return jsonResponse({ documentId: "document-1", parseRunId: "parse-1", status: "queued" }, 202);
      if (url.endsWith("/parse-runs/parse-1")) {
        pollCalls += 1;
        return pollCalls === 1
          ? jsonResponse({ id: "parse-1", documentId: "document-1", status: "running", progress: 40 })
          : jsonResponse({ id: "parse-1", documentId: "document-1", status: "completed", result: parseResult });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen(<ParseScreen />);

    await waitFor(() => expect(screen.getByTestId("parse-run-action")).toBeEnabled());
    await user.click(screen.getByTestId("parse-run-action"));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Lesson" })).toBeInTheDocument(), { timeout: 5_000 });
    expect(fetchMock.mock.calls.filter(([url, request]) => String(url).endsWith("/documents/document-1/parse") && (request as RequestInit | undefined)?.method === "POST")).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/documents/parse"))).toBe(false);
    expect(pollCalls).toBeGreaterThanOrEqual(2);

    // A2: only the state/phase text is live; the ticking timer and percentage are not.
    const lifecycle = screen.getByTestId("parse-lifecycle");
    expect(lifecycle).not.toHaveAttribute("aria-live");
    expect(lifecycle.querySelector("[aria-live], [role='status']")).toBeNull();
    expect(screen.getByTestId("parse-document-status")).not.toHaveAttribute("aria-live");
    const announcement = screen.getByTestId("parse-status-announcement");
    expect(announcement).toHaveAttribute("role", "status");
    expect(announcement).toHaveTextContent(/^Parsed$/);
  });

  it("does not show the previous run's number or duration while a new parse runs", async () => {
    const user = userEvent.setup();
    prepareActiveDocument();
    const previousRun = { ...runSummary("completed"), runNumber: 1, timing: { startedAt: "2026-01-01T10:00:00Z", completedAt: "2026-01-01T10:00:05Z", durationMs: 5_000 } };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return jsonResponse(capabilities);
      if (url.endsWith("/documents") && init?.method !== "POST") return jsonResponse({ items: [{ ...documentItem, activeParseRunId: "parse-1", pageCount: 1 }] });
      // The summary keeps listing only the finished run while the new one is in flight.
      if (url.split("?")[0].endsWith("/documents/document-1/summary")) return jsonResponse(summary([previousRun], "parse-1"));
      if (url.endsWith("/parse-runs/parse-1")) return jsonResponse({ id: "parse-1", documentId: "document-1", status: "completed", result: parseResult });
      if (url.endsWith("/documents/document-1/parse") && init?.method === "POST") return jsonResponse({ documentId: "document-1", parseRunId: "parse-2", status: "queued" }, 202);
      if (url.endsWith("/parse-runs/parse-2")) return jsonResponse({ id: "parse-2", documentId: "document-1", status: "running", progress: 30 });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen(<ParseScreen />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Parse again" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Parse again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Running" })).toBeDisabled());

    const lifecycle = screen.getByTestId("parse-lifecycle");
    expect(lifecycle).not.toHaveTextContent("Parse #1");
    const elapsed = screen.getByTestId("parse-elapsed");
    expect(elapsed.textContent).toMatch(/^\d+:\d{2}$/);
    expect(elapsed).not.toHaveTextContent("0:05");
  });

  it("keeps Elapsed as wall-clock time after the run ends and shows the parser time separately", async () => {
    const user = userEvent.setup();
    prepareActiveDocument();
    let summaryCalls = 0;
    let pollCalls = 0;
    // The worker's own processing time (13 s) is shorter than the time since Parse was requested.
    const completedRun = { ...runSummary("completed"), runNumber: 1, createdAt: "2026-01-01T10:00:00Z", timing: { startedAt: "2026-01-01T10:00:05Z", completedAt: "2026-01-01T10:00:19Z", durationMs: 13_000 } };
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return jsonResponse(capabilities);
      if (url.endsWith("/documents") && init?.method !== "POST") return jsonResponse({ items: [documentItem] });
      if (url.split("?")[0].endsWith("/documents/document-1/summary")) {
        summaryCalls += 1;
        return jsonResponse(summary(summaryCalls > 1 ? [completedRun] : [], summaryCalls > 1 ? "parse-1" : null));
      }
      if (url.endsWith("/documents/document-1/parse") && init?.method === "POST") return jsonResponse({ documentId: "document-1", parseRunId: "parse-1", status: "queued" }, 202);
      if (url.endsWith("/parse-runs/parse-1")) {
        pollCalls += 1;
        return pollCalls === 1
          ? jsonResponse({ id: "parse-1", documentId: "document-1", status: "running", progress: 40 })
          : jsonResponse({ id: "parse-1", documentId: "document-1", status: "completed", result: parseResult });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen(<ParseScreen />);

    await waitFor(() => expect(screen.getByTestId("parse-run-action")).toBeEnabled());
    await user.click(screen.getByTestId("parse-run-action"));
    await waitFor(() => expect(screen.getByTestId("parse-parser-time")).toHaveTextContent("Parser time 0:13"), { timeout: 5_000 });
    // The stopwatch did not jump to the worker duration (or any server timestamp difference).
    const elapsed = screen.getByTestId("parse-elapsed");
    expect(elapsed.textContent).toMatch(/^0:0\d$/);
    expect(screen.getByTestId("parse-result-summary")).toBeInTheDocument();
  });

  it("updates the document library row when a parse completes", async () => {
    const user = userEvent.setup();
    prepareActiveDocument();
    let summaryCalls = 0;
    let pollCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return jsonResponse(capabilities);
      if (url.endsWith("/documents") && init?.method !== "POST") return jsonResponse({ items: [documentItem] });
      if (url.split("?")[0].endsWith("/documents/document-1/summary")) {
        summaryCalls += 1;
        return jsonResponse(summary(summaryCalls > 1 ? [runSummary("completed")] : [], summaryCalls > 1 ? "parse-1" : null));
      }
      if (url.endsWith("/documents/document-1/parse") && init?.method === "POST") return jsonResponse({ documentId: "document-1", parseRunId: "parse-1", status: "queued" }, 202);
      if (url.endsWith("/parse-runs/parse-1")) {
        pollCalls += 1;
        return pollCalls === 1
          ? jsonResponse({ id: "parse-1", documentId: "document-1", status: "running", progress: 40 })
          : jsonResponse({ id: "parse-1", documentId: "document-1", status: "completed", result: parseResult });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen(<><ParseScreen /><DocumentLibrary /></>);

    const row = async () => within(await screen.findByTestId("document-library-table")).getByTestId("document-library-row");
    await waitFor(async () => expect(await row()).toHaveTextContent("Not parsed"));
    await waitFor(() => expect(screen.getByTestId("parse-run-action")).toBeEnabled());
    await user.click(screen.getByTestId("parse-run-action"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Lesson" })).toBeInTheDocument(), { timeout: 5_000 });
    await waitFor(async () => expect(within(await row()).getByText("Parsed")).toBeInTheDocument());
    expect(within(await row()).getByRole("cell", { name: "1" })).toBeInTheDocument();
  });

  it("guards duplicate Parse clicks while the run is queued", async () => {
    prepareActiveDocument();
    let postCalls = 0;
    let pollCalls = 0;
    let summaryCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return jsonResponse(capabilities);
      if (url.endsWith("/documents") && init?.method !== "POST") return jsonResponse({ items: [documentItem] });
      if (url.split("?")[0].endsWith("/documents/document-1/summary")) {
        summaryCalls += 1;
        return jsonResponse(summary(summaryCalls > 1 ? [runSummary("completed")] : [], summaryCalls > 1 ? "parse-1" : null));
      }
      if (url.endsWith("/documents/document-1/parse") && init?.method === "POST") {
        postCalls += 1;
        return jsonResponse({ documentId: "document-1", parseRunId: "parse-1", status: "queued" }, 202);
      }
      if (url.endsWith("/parse-runs/parse-1")) {
        pollCalls += 1;
        return pollCalls === 1
          ? jsonResponse({ id: "parse-1", documentId: "document-1", status: "running", progress: 40 })
          : jsonResponse({ id: "parse-1", documentId: "document-1", status: "completed", result: parseResult });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen(<ParseScreen />);

    await waitFor(() => expect(screen.getByTestId("parse-run-action")).toBeEnabled());
    const parseButton = screen.getByTestId("parse-run-action");
    fireEvent.click(parseButton);
    await waitFor(() => expect(screen.getByRole("button", { name: "Running" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Running" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Lesson" })).toBeInTheDocument(), { timeout: 5_000 });
    expect(postCalls).toBe(1);
  });

  it("surfaces a terminal failure returned by explicit Parse", async () => {
    const user = userEvent.setup();
    prepareActiveDocument();
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return jsonResponse(capabilities);
      if (url.endsWith("/documents") && init?.method !== "POST") return jsonResponse({ items: [documentItem] });
      if (url.split("?")[0].endsWith("/documents/document-1/summary")) return jsonResponse(summary());
      if (url.endsWith("/documents/document-1/parse") && init?.method === "POST") return jsonResponse({ documentId: "document-1", parseRunId: "parse-1", status: "failed", error: { code: "modal_dispatch_failed", message: "The parse worker could not be started." } }, 202);
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen(<ParseScreen />);

    await waitFor(() => expect(screen.getByTestId("parse-run-action")).toBeEnabled());
    await user.click(screen.getByTestId("parse-run-action"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The processing service couldn't start. This is usually temporary; try again in a minute.");
    // The backend's own wording stays one click away.
    expect(within(alert).getByTestId("api-error-details")).toHaveTextContent("Code: modal_dispatch_failed");
    expect(within(alert).getByTestId("api-error-details")).toHaveTextContent("Message: The parse worker could not be started.");
    expect(screen.queryByRole("heading", { name: "Lesson" })).not.toBeInTheDocument();
  });

  it("recovers from a transient polling outage without failing the parse", async () => {
    const user = userEvent.setup();
    prepareActiveDocument();
    let pollCalls = 0;
    let summaryCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return jsonResponse(capabilities);
      if (url.endsWith("/documents") && init?.method !== "POST") return jsonResponse({ items: [documentItem] });
      if (url.split("?")[0].endsWith("/documents/document-1/summary")) {
        summaryCalls += 1;
        return jsonResponse(summary(summaryCalls > 1 ? [runSummary("completed")] : [], summaryCalls > 1 ? "parse-1" : null));
      }
      if (url.endsWith("/documents/document-1/parse") && init?.method === "POST") return jsonResponse({ documentId: "document-1", parseRunId: "parse-1", status: "queued" }, 202);
      if (url.endsWith("/parse-runs/parse-1")) {
        pollCalls += 1;
        if (pollCalls === 1) return jsonResponse({ error: { code: "temporary_outage", message: "temporary outage" } }, 503);
        if (pollCalls === 2) return jsonResponse({ id: "parse-1", documentId: "document-1", status: "running", progress: 40 });
        return jsonResponse({ id: "parse-1", documentId: "document-1", status: "completed", result: parseResult });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen(<ParseScreen />);

    await waitFor(() => expect(screen.getByTestId("parse-run-action")).toBeEnabled());
    await user.click(screen.getByTestId("parse-run-action"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Lesson" })).toBeInTheDocument(), { timeout: 5_000 });
    expect(pollCalls).toBeGreaterThanOrEqual(3);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("maps an interrupted backend run to a failed Parse with safe copy", async () => {
    const user = userEvent.setup();
    prepareActiveDocument();
    let summaryCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return jsonResponse(capabilities);
      if (url.endsWith("/documents") && init?.method !== "POST") return jsonResponse({ items: [documentItem] });
      if (url.split("?")[0].endsWith("/documents/document-1/summary")) {
        summaryCalls += 1;
        return jsonResponse(summary(summaryCalls > 1 ? [runSummary("failed", { code: "parse_interrupted", message: "The parse stopped before completion." })] : [], null));
      }
      if (url.endsWith("/documents/document-1/parse") && init?.method === "POST") return jsonResponse({ documentId: "document-1", parseRunId: "parse-1", status: "queued" }, 202);
      if (url.endsWith("/parse-runs/parse-1")) return jsonResponse({ id: "parse-1", documentId: "document-1", status: "interrupted" });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen(<ParseScreen />);

    await waitFor(() => expect(screen.getByTestId("parse-run-action")).toBeEnabled());
    await user.click(screen.getByTestId("parse-run-action"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Parsing stopped before it finished. Parse the document again.");
    expect(within(alert).getByTestId("api-error-details")).toHaveTextContent("The parse run was interrupted before completion.");
  });

  it("resumes a queued parse after bootstrap without creating another run", async () => {
    prepareActiveDocument();
    let pollCalls = 0;
    let summaryCalls = 0;
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return jsonResponse(capabilities);
      if (url.endsWith("/documents") && init?.method !== "POST") return jsonResponse({ items: [documentItem] });
      if (url.split("?")[0].endsWith("/documents/document-1/summary")) {
        summaryCalls += 1;
        return jsonResponse(summary(summaryCalls === 1 ? [runSummary("queued")] : [runSummary("completed")], summaryCalls > 1 ? "parse-1" : null));
      }
      if (url.endsWith("/parse-runs/parse-1")) {
        pollCalls += 1;
        return pollCalls === 1
          ? jsonResponse({ id: "parse-1", documentId: "document-1", status: "running", progress: 55 })
          : jsonResponse({ id: "parse-1", documentId: "document-1", status: "completed", result: parseResult });
      }
      if (url.endsWith("/documents/document-1/parse") && init?.method === "POST") throw new Error("resume must not create another run");
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen(<ParseScreen />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Lesson" })).toBeInTheDocument(), { timeout: 5_000 });
    expect(pollCalls).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls.some(([url, request]) => String(url).endsWith("/documents/document-1/parse") && (request as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("rejects a non-PDF from the direct upload surface before upload", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/capabilities")) return jsonResponse(capabilities);
      if (url.endsWith("/documents") && init?.method !== "POST") return jsonResponse({ items: [] });
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderScreen(<DocumentsScreen />);

    fireEvent.change(screen.getByLabelText("Choose PDF"), { target: { files: [new File(["plain text"], "notes.txt", { type: "text/plain" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Only PDF files are supported.");
    expect(screen.getByText("notes.txt", { exact: false })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, request]) => String(url).endsWith("/documents") && (request as RequestInit | undefined)?.method === "POST")).toBe(false);
  });
});
