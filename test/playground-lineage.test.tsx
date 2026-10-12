import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/playground" }));

import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { PreferencesProvider } from "@/components/preferences-provider";
import { RetrievalScreen } from "@/components/retrieval-screen";

const capabilities = { embeddingModel: "gemini", embeddingDimensions: 768, generationModel: "gemini", rerankModel: "gemini", judgeModel: "gemini", embeddingFormatVersion: "v1", limits: {} };

function json(payload: unknown) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
}

const run = (id: string, upstream: Record<string, string>, isCompatible = true) => ({ id, status: "completed", isCompatible, upstream, config: {}, timing: {}, error: null });
const keywordExperiment = {
  ...run("experiment-1", { chunkRunId: "chunk-1" }),
  documentId: "document-1",
  chunkRunId: "chunk-1",
  embeddingRunId: null,
  query: "What is RAG?",
  targetStage: "retrieval",
  config: { retrieval: { mode: "keyword", topK: 5 } },
  stageResults: { retrieval: { candidates: [], results: [], durationMs: 1 } },
};

function summary(embeddingCompatible: boolean) {
  return {
    id: "document-1",
    fileName: "lesson.pdf",
    mediaType: "application/pdf",
    sizeBytes: 9,
    pageCount: 1,
    activeParseRunId: "parse-1",
    activeChunkRunId: "chunk-1",
    activeEmbeddingRunId: "embedding-1",
    parseRuns: [run("parse-1", {})],
    chunkRuns: [run("chunk-1", { parseRunId: "parse-1" })],
    embeddingRuns: [run("embedding-1", { chunkRunId: "chunk-1" }, embeddingCompatible)],
    // A keyword run needs no embedding, so the backend keeps it compatible either way.
    experiments: [{ ...keywordExperiment, stageResults: undefined, stageStatuses: { retrieval: "completed" } }],
    evaluationDatasets: [],
    evaluationRuns: [],
  };
}

function renderPlayground(embeddingCompatible: boolean) {
  localStorage.setItem("rag-steplab-active-document-id:test-user", "document-1");
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.endsWith("/capabilities")) return json(capabilities);
    if (url.endsWith("/documents")) return json({ items: [{ ...summary(embeddingCompatible), parseRuns: undefined }] });
    if (url.split("?")[0].endsWith("/documents/document-1/summary")) return json(summary(embeddingCompatible));
    if (url.endsWith("/documents/document-1/pipelines")) return json([{ id: "pipeline-1", documentId: "document-1", name: "Default Pipeline", parseRunId: "parse-1", chunkRunId: "chunk-1", embeddingRunId: "embedding-1", revision: 1, isDefault: true }]);
    if (url.includes("/parse-runs/")) return new Promise<Response>(() => undefined);
    if (url.endsWith("/experiments/experiment-1")) return json(keywordExperiment);
    throw new Error(`unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<PreferencesProvider><DocumentPipelineProvider><RetrievalScreen /></DocumentPipelineProvider></PreferencesProvider>);
  return { experimentRequested: () => fetchMock.mock.calls.some(([url]) => String(url).endsWith("/experiments/experiment-1")) };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Playground lineage", () => {
  it("shows the pipeline's latest experiment while its lineage is intact", async () => {
    renderPlayground(true);

    expect(await screen.findByTestId("playground-result-meta")).toBeInTheDocument();
    expect(screen.queryByTestId("playground-blocker")).not.toBeInTheDocument();
  });

  it("presents no earlier experiment as current once the saved pipeline's lineage is incompatible", async () => {
    const { experimentRequested } = renderPlayground(false);

    await waitFor(() => expect(screen.getByTestId("playground-blocker")).toHaveTextContent("doesn't match the current pipeline"));
    // Give the use-screen hydration a chance to (wrongly) load the keyword run.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(experimentRequested()).toBe(false);
    expect(screen.queryByTestId("playground-result-meta")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run next stage" })).not.toBeInTheDocument();
  });
});
