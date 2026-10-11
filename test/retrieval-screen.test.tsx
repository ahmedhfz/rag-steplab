import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
  it("shows a neutral skeleton while the workspace loads, then one truthful blocker", async () => {
    let finishDocuments!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/capabilities")) return json(capabilities);
      if (url.endsWith("/documents")) return new Promise<Response>((resolve) => { finishDocuments = resolve; });
      throw new Error(`unexpected request: ${url}`);
    }));
    renderRetrieval();

    const run = screen.getByRole("button", { name: "Run experiment" });
    expect(run).toBeDisabled();
    // Loading is never presented as a lock or a missing document (live audit L1).
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("playground-blocker")).not.toBeInTheDocument();
    expect(screen.queryByText(/Select a document/)).not.toBeInTheDocument();

    await waitFor(() => expect(finishDocuments).toBeTypeOf("function"));
    finishDocuments(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const blocker = await screen.findByTestId("playground-blocker");
    expect(blocker).toHaveTextContent("Select a document to continue.");
    expect(blocker).not.toHaveTextContent("Action blocked");
    expect(within(blocker).getByRole("link", { name: "Go to Documents" })).toHaveAttribute("href", "/documents");
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Question" })).toHaveAccessibleName("Question");
    expect(run).toHaveAccessibleDescription("Select a document to continue.");
    expect(screen.getByRole("button", { name: "Hybrid" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("switch", { name: "Reranker" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Advanced settings")).toBeInTheDocument();
    expect(screen.queryByText(/persisted backend|upstream artifact|reranker score/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy trace" })).not.toBeInTheDocument();

    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset).toBeDisabled();
    expect(reset).toHaveAccessibleDescription("No query settings have changed.");
  });

  it("treats an empty question with a complete lineage as ready, not blocked", async () => {
    const user = userEvent.setup();
    localStorage.setItem("rag-steplab-active-document-id:test-user", "document-1");
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/capabilities")) return json(capabilities);
      if (url.endsWith("/documents")) return json({ items: [{ ...summary(), parseRuns: undefined }] });
      if (url.split("?")[0].endsWith("/documents/document-1/summary")) return json(summary());
      if (url.endsWith("/documents/document-1/pipelines")) return json([]);
      if (url.includes("/parse-runs/")) return new Promise<Response>(() => undefined);
      throw new Error(`unexpected request: ${url}`);
    }));
    renderRetrieval();

    const run = screen.getByRole("button", { name: "Run experiment" });
    await waitFor(() => expect(run).toHaveAccessibleDescription("Enter a question to run an experiment."));
    expect(screen.queryByTestId("playground-blocker")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ask your document a question", level: 2 })).toBeInTheDocument();
    expect(run).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: "Question" }), "What is RAG?");
    expect(run).toBeEnabled();
  });

  it("prepares and resets request parameters, keeps focus after clearing and shows the candidate count only with the reranker", async () => {
    const user = userEvent.setup();
    stubEmptyWorkspace();
    renderRetrieval();
    await waitFor(() => expect(screen.getByTestId("playground-blocker")).toHaveTextContent("Select a document"));

    const question = screen.getByRole("textbox", { name: "Question" });
    await user.type(question, "What is RAG?");
    await user.click(screen.getByRole("button", { name: "Clear question" }));
    expect(question).toHaveValue("");
    // The clear button unmounts; focus returns to the field instead of the body (a11y A6).
    expect(question).toHaveFocus();

    await user.click(screen.getByText("Advanced settings"));
    expect(screen.queryByLabelText("Rerank candidate count")).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Reranker" }));
    expect(screen.getByLabelText("Rerank candidate count")).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Reranker" }));
    expect(screen.queryByLabelText("Rerank candidate count")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Top-K" }));
    await user.click(screen.getByRole("option", { name: "10" }));
    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset).toBeEnabled();

    await user.click(reset);
    expect(screen.getByRole("combobox", { name: "Top-K" })).toHaveTextContent("5");
    expect(screen.getByRole("button", { name: "Hybrid" })).toHaveAttribute("aria-pressed", "true");
    expect(reset).toBeDisabled();
  });
});
