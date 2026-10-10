import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreferencesProvider } from "@/components/preferences-provider";
import { RetrievalScreen } from "@/components/retrieval-screen";
import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";

const capabilities = {
  embeddingModel: "gemini",
  embeddingDimensions: 768,
  generationModel: "gemini",
  rerankModel: "gemini",
  judgeModel: "gemini",
  embeddingFormatVersion: "v1",
  limits: {},
};

function json(payload: unknown) {
  return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
}

function stubEmptyWorkspace() {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.endsWith("/capabilities")) return json(capabilities);
    if (url.endsWith("/documents")) return json({ items: [] });
    throw new Error(`unexpected request: ${url}`);
  }));
}

function summary() {
  const run = (id: string, upstream: Record<string, string>) => ({ id, status: "completed", isCompatible: true, upstream, config: {}, timing: {}, error: null });
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
    embeddingRuns: [run("embedding-1", { chunkRunId: "chunk-1" })],
    experiments: [],
    evaluationDatasets: [],
    evaluationRuns: [],
  };
}

function renderRetrieval() {
  return render(
    <PreferencesProvider>
      <DocumentPipelineProvider><RetrievalScreen /></DocumentPipelineProvider>
    </PreferencesProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("RetrievalScreen", () => {
  it("shows no blocker while the workspace loads, then one truthful blocker", async () => {
    let finishDocuments!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/capabilities")) return json(capabilities);
      if (url.endsWith("/documents")) return new Promise<Response>((resolve) => { finishDocuments = resolve; });
      throw new Error(`unexpected request: ${url}`);
    }));
    renderRetrieval();

    const run = screen.getByRole("button", { name: "Run experiment" });
    expect(run).toBeDisabled();
    expect(screen.queryByTestId("playground-blocker")).not.toBeInTheDocument();
    expect(screen.queryByText("Select a document")).not.toBeInTheDocument();

    await waitFor(() => expect(finishDocuments).toBeTypeOf("function"));
    finishDocuments(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await waitFor(() => expect(screen.getByTestId("playground-blocker")).toHaveTextContent("Action blocked"));
    expect(screen.getByRole("textbox", { name: "Question" })).toHaveAccessibleName("Question");
    expect(run).toHaveAccessibleDescription("Select a document and complete indexing setup first.");
    expect(screen.getByTestId("playground-blocker")).toHaveTextContent("Go to Documents");
    expect(screen.getByRole("button", { name: "Hybrid" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("switch", { name: "Reranker" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Advanced settings")).toBeInTheDocument();
    expect(screen.queryByTestId("playground-draft-configuration")).not.toBeInTheDocument();
    expect(screen.queryByText(/persisted backend|upstream artifact|reranker score/i)).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Copy trace" })).not.toBeInTheDocument();

    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset).toBeDisabled();
    expect(reset).toHaveAccessibleDescription("No query settings have changed.");
    expect(screen.getByTestId("playground-blocker")).toHaveTextContent("Select a document");
    expect(screen.queryByText("No trace data is available yet.")).not.toBeInTheDocument();
  });

  it("treats an empty question with a complete lineage as ready, not blocked", async () => {
    const user = userEvent.setup();
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-1");
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/capabilities")) return json(capabilities);
      if (url.endsWith("/documents")) return json({ items: [{ ...summary(), parseRuns: undefined }] });
      if (url.endsWith("/documents/document-1/summary")) return json(summary());
      if (url.endsWith("/documents/document-1/pipelines")) return json([]);
      if (url.includes("/parse-runs/")) return new Promise<Response>(() => undefined);
      throw new Error(`unexpected request: ${url}`);
    }));
    renderRetrieval();

    const run = screen.getByRole("button", { name: "Run experiment" });
    await waitFor(() => expect(run).toHaveAccessibleDescription("Enter a question to run an experiment."));
    expect(screen.queryByTestId("playground-blocker")).not.toBeInTheDocument();
    expect(run).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "Question" }), "What is RAG?");
    expect(run).toBeEnabled();
  });

  it("allows request parameters to be prepared and reset without running fake retrieval", async () => {
    const user = userEvent.setup();
    stubEmptyWorkspace();
    renderRetrieval();
    await waitFor(() => expect(screen.getByTestId("playground-blocker")).toHaveTextContent("Select a document"));

    const question = screen.getByRole("textbox", { name: "Question" });
    await user.type(question, "What is RAG?");
    expect(screen.getByRole("button", { name: "Clear question" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear question" }));
    expect(question).toHaveValue("");

    await user.click(screen.getByText("Advanced settings"));
    expect(screen.getByRole("switch", { name: "Reranker" })).toBeEnabled();
    await user.click(screen.getByRole("combobox", { name: "Top-K" }));
    await user.click(screen.getByRole("option", { name: "10" }));
    await user.click(screen.getByRole("button", { name: "Hybrid" }));
    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset).toBeEnabled();

    await user.click(reset);
    expect(question).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Top-K" })).toHaveTextContent("5");
    expect(screen.getByRole("button", { name: "Hybrid" })).toHaveAttribute("aria-pressed", "true");
    expect(reset).toBeDisabled();
    expect(screen.getByTestId("playground-blocker")).toHaveTextContent("Select a document");
  });
});
