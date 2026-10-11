import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const pipeline = vi.hoisted(() => ({
  value: {
    activeDocument: {
      id: "document-1",
      parseRuns: [{ id: "parse-1", status: "completed", isCompatible: true }],
      chunkRuns: [{ id: "chunk-1", status: "completed", isCompatible: true, upstream: { parseRunId: "parse-1" } }],
      embeddingRuns: [],
    },
    selectedParseRunId: "parse-1",
    selectedChunkRunId: "chunk-1",
    selectedEmbeddingRunId: null,
    parseResult: null,
    capabilities: null,
    persistenceStatus: "available",
    chunkStatus: "ready",
    chunkRun: null,
    chunkError: null,
    embeddingStatus: "ready",
    embeddingRun: null,
    embeddingError: null,
    runChunking: vi.fn(),
    runEmbedding: vi.fn(),
    selectChunkRun: vi.fn(),
    selectEmbeddingRun: vi.fn(),
  },
}));

vi.mock("@/components/document-pipeline-provider", () => ({
  useDocumentPipeline: () => pipeline.value,
}));

import { ChunksPipeline } from "@/components/chunks-pipeline";
import { PreferencesProvider } from "@/components/preferences-provider";

describe("artifact reuse UX contract", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows reuse only when the create response reports reusedArtifact", async () => {
    pipeline.value.runChunking.mockResolvedValue({ reusedArtifact: true });
    const user = userEvent.setup();

    render(<PreferencesProvider><ChunksPipeline stage="chunking" /></PreferencesProvider>);
    await user.click(screen.getByRole("button", { name: "Run chunking" }));

    expect(await screen.findByTestId("chunk-reuse-notice")).toHaveTextContent("Previous output was reused.");
  });

  it("does not infer reuse from a normal create response", async () => {
    pipeline.value.runChunking.mockResolvedValue({ reusedArtifact: false });
    const user = userEvent.setup();

    render(<PreferencesProvider><ChunksPipeline stage="chunking" /></PreferencesProvider>);
    await user.click(screen.getByRole("button", { name: "Run chunking" }));

    expect(screen.queryByTestId("chunk-reuse-notice")).not.toBeInTheDocument();
  });

  it("uses the same response-only rule for embeddings", async () => {
    pipeline.value.runEmbedding.mockResolvedValue({ reusedArtifact: true });
    const user = userEvent.setup();

    render(<PreferencesProvider><ChunksPipeline stage="embeddings" /></PreferencesProvider>);
    await user.click(screen.getByRole("button", { name: "Create embeddings" }));

    expect(await screen.findByTestId("embedding-reuse-notice")).toHaveTextContent("Previous output was reused.");
  });
});
