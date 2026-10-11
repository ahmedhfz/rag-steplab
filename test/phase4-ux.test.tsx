import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChunkingScreen, EmbeddingsScreen } from "@/components/pipeline-stage-screens";
import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { DocumentsScreen } from "@/components/documents-screen";
import { ParseScreen } from "@/components/parse-screen";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
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

describe("Phase 6B pipeline IA", () => {
  it("renders Documents with one clickable PDF drop surface", () => {
    renderWithPipeline(<DocumentsScreen />);

    expect(screen.getByRole("heading", { name: "Documents", level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId("document-upload-panel")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-drop-zone")).toHaveAttribute("type", "button");
    expect(screen.getByLabelText("Choose PDF")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add PDF" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-context-bar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Parse|Reparse/i })).not.toBeInTheDocument();
  });

  it("keeps Parse, Chunking, and Embeddings actions disabled with explicit upstream reasons", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const payload = url.endsWith("/capabilities") ? capabilities : { items: [] };
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    }));
    renderWithPipeline(<ParseScreen />);
    expect(screen.getByRole("heading", { name: "Parsing", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Parse" })).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId("parse-blocker")).toHaveTextContent("Select a document to continue."));
    expect(within(screen.getByTestId("parse-blocker")).getByRole("link", { name: /Go to Documents/ })).toHaveAttribute("href", "/documents");
    expect(screen.getByRole("button", { name: "Parse" })).toHaveAccessibleDescription(/Select a document to continue/);

    cleanup();
    renderWithPipeline(<ChunkingScreen />);
    expect(screen.getByRole("button", { name: "Run chunking" })).toBeDisabled();
    // The locked next step stays visible (disabled) instead of disappearing.
    expect(screen.getByTestId("chunking-next-action")).toBeDisabled();
    await waitFor(() => expect(document.getElementById("chunk-disabled-reason")).toBeTruthy());
    expect(document.getElementById("chunk-disabled-reason")).toHaveTextContent(/operation|document|parse/i);

    cleanup();
    renderWithPipeline(<EmbeddingsScreen />);
    expect(screen.getByRole("button", { name: "Create embeddings" })).toBeDisabled();
    expect(screen.getByTestId("embeddings-next-action")).toBeDisabled();
    await waitFor(() => expect(screen.getByTestId("embedding-blocker")).toBeInTheDocument());
    expect(screen.getByTestId("embedding-blocker")).toHaveTextContent(/operation|document|chunk run/i);
  });

  it("keeps the Playground route available even when no embedding is selected", () => {
    renderWithPipeline(<PipelineContextBar />);
    expect(screen.getByTestId("pipeline-context-bar")).toBeInTheDocument();
    expect(screen.getByText("No active document")).toBeInTheDocument();
  });
});
