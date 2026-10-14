import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/parse" }));

vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { ParseScreen } from "@/components/parse-screen";
import { EmbeddingsScreen } from "@/components/pipeline-stage-screens";
import { PreferencesProvider } from "@/components/preferences-provider";

const capabilities = { embeddingModel: "gemini", embeddingDimensions: 768, generationModel: "gemini", rerankModel: "gemini", judgeModel: "gemini", embeddingFormatVersion: "v1", limits: {} };
const documentId = "document-1";
const incompatible = /doesn't match the current pipeline/;

function json(payload: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }));
}

const run = (id: string, runNumber: number, upstream: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  id, runNumber, status: "completed", progress: 100, isCompatible: true, isStale: false, historicalLineage: false,
  upstream: { documentId, ...upstream }, config: {}, timing: { startedAt: null, completedAt: null, durationMs: null }, error: null, ...extra,
});

const parseRun = run("parse-1", 1, {});
const chunkRun = run("chunk-1", 1, { parseRunId: "parse-1" }, { strategy: "structure_aware", chunkCount: 10, config: { chunkSizeTokens: 512, overlapTokens: 64 } });
const embeddingRun = run("embedding-1", 1, { chunkRunId: "chunk-1" }, { documentId, chunkRunId: "chunk-1", model: "gemini", dimensions: 768, embeddingFormatVersion: "v1", embeddingCount: 10 });

const parseResult = {
  document: { id: documentId, fileName: "lesson.pdf", mediaType: "application/pdf", sizeBytes: 9, pageCount: 1 },
  structured: {
    pages: [{ pageNumber: 1, elements: [{ id: "element-1", type: "heading", pageNumbers: [1], text: "Lesson", level: 1, table: null }] }],
    elements: [{ id: "element-1", type: "heading", pageNumbers: [1], text: "Lesson", level: 1, table: null }],
  },
  markdown: "# Lesson",
  summary: { pageCount: 1, headingCount: 1, paragraphCount: 0, listCount: 0, tableCount: 0 },
  documentId,
  parseRunId: "parse-1",
  status: "completed",
  runMetadata: { parser: "docling" },
};

function summary(runs: { parseRuns?: unknown[]; chunkRuns?: unknown[]; embeddingRuns?: unknown[] }) {
  return {
    id: documentId, fileName: "lesson.pdf", mediaType: "application/pdf", sizeBytes: 9, pageCount: 1, sha256: "sha-1",
    activeParseRunId: null, activeChunkRunId: null, activeEmbeddingRunId: null,
    parseRuns: runs.parseRuns ?? [], chunkRuns: runs.chunkRuns ?? [], embeddingRuns: runs.embeddingRuns ?? [],
    experiments: [], evaluationDatasets: [], evaluationRuns: [],
  };
}

const pipeline = { id: "pipeline-1", documentId, name: "Default Pipeline", parseRunId: null as string | null, chunkRunId: null as string | null, embeddingRunId: null as string | null, revision: 1, isDefault: true, createdAt: null, updatedAt: null };

type Route = (path: string, init?: RequestInit) => Promise<Response> | null;

/**
 * A saved pipeline workspace whose summary refresh after the pipeline PATCH
 * waits for `releaseSummary`: that is the window between the saved lineage and
 * the snapshot that shows it.
 */
function renderWorkspace(screenNode: React.ReactNode, { initial, completed, savedPipeline, route }: {
  initial: ReturnType<typeof summary>;
  completed: ReturnType<typeof summary>;
  savedPipeline: typeof pipeline;
  route: Route;
}) {
  localStorage.setItem("rag-steplab-active-document-id:test-user", documentId);
  let releaseSummary!: () => void;
  const summaryGate = new Promise<void>((resolve) => { releaseSummary = resolve; });
  const state = { patched: false };
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const path = url.split("?")[0];
    if (path.endsWith("/capabilities")) return json(capabilities);
    if (path.endsWith("/documents")) return json({ items: [{ ...initial, parseRuns: undefined, chunkRuns: undefined, embeddingRuns: undefined }] });
    if (path.endsWith(`/documents/${documentId}/pipelines`)) return json([savedPipeline]);
    if (path.endsWith(`/documents/${documentId}/summary`)) return state.patched ? summaryGate.then(() => json(completed)) : json(initial);
    const routed = route(path, init);
    if (routed) return routed;
    if (path.endsWith("/document-pipelines/pipeline-1") && init?.method === "PATCH") {
      state.patched = true;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return json({ ...savedPipeline, revision: savedPipeline.revision + 1, parseRunId: body.parseRunId, chunkRunId: body.chunkRunId, embeddingRunId: body.embeddingRunId });
    }
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<PreferencesProvider><DocumentPipelineProvider>{screenNode}</DocumentPipelineProvider></PreferencesProvider>);
  return {
    releaseSummary,
    /** Resolves once the PATCH answered and its response had time to render. */
    pipelineSaved: async () => {
      await waitFor(() => expect(state.patched).toBe(true), { timeout: 3_000 });
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    },
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Stage completion lineage transition", () => {
  it("keeps a finishing parse in flight until its result and the saved pipeline commit together", async () => {
    navigation.pathname = "/parse";
    const workspace = renderWorkspace(<ParseScreen />, {
      initial: summary({}),
      completed: summary({ parseRuns: [parseRun] }),
      savedPipeline: pipeline,
      route: (path, init) => {
        if (path.endsWith(`/documents/${documentId}/parse`) && init?.method === "POST") return json({ id: "parse-1", documentId, status: "running", progress: 40 }, 202);
        if (path.endsWith("/parse-runs/parse-1")) return json({ id: "parse-1", documentId, status: "completed", progress: 100, result: parseResult });
        return null;
      },
    });

    await waitFor(() => expect(screen.getByTestId("parse-run-action")).toBeEnabled());
    fireEvent.click(screen.getByTestId("parse-run-action"));
    await workspace.pipelineSaved();

    // The run finished and the pipeline names it, but its result is not committed yet.
    expect(screen.getByTestId("parse-status-announcement")).not.toHaveTextContent("Not parsed yet");
    expect(screen.getByTestId("parse-run-action")).toBeDisabled();
    expect(screen.queryByTestId("parse-empty-action")).not.toBeInTheDocument();
    expect(screen.queryByTestId("parse-blocker")).not.toBeInTheDocument();
    expect(screen.queryByText(incompatible)).not.toBeInTheDocument();

    workspace.releaseSummary();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Lesson" })).toBeInTheDocument());
    expect(screen.getByTestId("parse-status-announcement")).toHaveTextContent(/^Parsed$/);
    expect(screen.queryByText(incompatible)).not.toBeInTheDocument();
  });

  it("does not flash an incompatible next step while a finished embedding run is committed", async () => {
    navigation.pathname = "/embeddings";
    const workspace = renderWorkspace(<EmbeddingsScreen />, {
      initial: summary({ parseRuns: [parseRun], chunkRuns: [chunkRun] }),
      completed: summary({ parseRuns: [parseRun], chunkRuns: [chunkRun], embeddingRuns: [embeddingRun] }),
      savedPipeline: { ...pipeline, parseRunId: "parse-1", chunkRunId: "chunk-1" },
      route: (path, init) => {
        if (path.endsWith(`/documents/${documentId}/embeddings`) && init?.method === "POST") return json(embeddingRun);
        if (path.endsWith("/embedding-runs/embedding-1")) return json(embeddingRun);
        return null;
      },
    });

    await waitFor(() => expect(screen.getByTestId("embedding-run-action")).toBeEnabled());
    fireEvent.click(screen.getByTestId("embedding-run-action"));
    await workspace.pipelineSaved();

    expect(screen.queryByTestId("embedding-blocker")).not.toBeInTheDocument();
    expect(screen.getByTestId("embeddings-next-action-footer")).not.toHaveTextContent(incompatible);
    expect(screen.queryByText(incompatible)).not.toBeInTheDocument();

    workspace.releaseSummary();
    await waitFor(() => expect(screen.getByTestId("embedding-output-result")).toHaveTextContent("10 vectors"));
    expect(screen.getByTestId("embedding-lineage")).toHaveTextContent("In use");
    expect(screen.getByTestId("embeddings-next-action")).toHaveAttribute("href", "/playground");
    expect(screen.queryByText(incompatible)).not.toBeInTheDocument();
  });

  it("does not leave a finished parse in flight when its pipeline write cannot be reconciled", async () => {
    navigation.pathname = "/parse";
    localStorage.setItem("rag-steplab-active-document-id:test-user", documentId);
    let pipelineLists = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const path = url.split("?")[0];
      if (path.endsWith("/capabilities")) return json(capabilities);
      if (path.endsWith("/documents")) return json({ items: [{ ...summary({}), parseRuns: undefined }] });
      if (path.endsWith(`/documents/${documentId}/summary`)) return json(summary({}));
      if (path.endsWith(`/documents/${documentId}/pipelines`)) {
        pipelineLists += 1;
        return pipelineLists === 1 ? json([pipeline]) : json({ error: { code: "internal_error", message: "Down." } }, 500);
      }
      if (path.endsWith(`/documents/${documentId}/parse`) && init?.method === "POST") return json({ id: "parse-1", documentId, status: "running", progress: 40 }, 202);
      if (path.endsWith("/parse-runs/parse-1")) return json({ id: "parse-1", documentId, status: "completed", progress: 100, result: parseResult });
      if (path.endsWith("/document-pipelines/pipeline-1") && init?.method === "PATCH") return json({ error: { code: "pipeline_conflict", message: "Stale revision" } }, 409);
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
    }));
    render(<PreferencesProvider><DocumentPipelineProvider><ParseScreen /></DocumentPipelineProvider></PreferencesProvider>);

    await waitFor(() => expect(screen.getByTestId("parse-run-action")).toBeEnabled());
    fireEvent.click(screen.getByTestId("parse-run-action"));
    await waitFor(() => expect(pipelineLists).toBe(2), { timeout: 3_000 });

    // The run is not in the lineage; the page leaves the in-flight state instead of spinning on.
    await waitFor(() => expect(screen.getByTestId("parse-run-action")).toBeEnabled());
    expect(screen.getByTestId("parse-run-action")).not.toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(incompatible)).not.toBeInTheDocument();
  });
});
