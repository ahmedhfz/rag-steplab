import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChunkingScreen, EmbeddingsScreen } from "@/components/pipeline-stage-screens";
import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { DocumentsScreen } from "@/components/documents-screen";
import { ParseScreen } from "@/components/parse-screen";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
import { PreferencesProvider } from "@/components/preferences-provider";

function renderWithPipeline(node: React.ReactNode) {
  return render(<PreferencesProvider><DocumentPipelineProvider>{node}</DocumentPipelineProvider></PreferencesProvider>);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Phase 4 pipeline IA", () => {
  it("renders Documents as the upload/library/status entry point", () => {
    renderWithPipeline(<DocumentsScreen />);

    expect(screen.getByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(screen.getByTestId("document-upload-panel")).toBeInTheDocument();
    expect(screen.getByTestId("pipeline-context-bar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pipeline status summary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Parse Document" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Go to Parse" })).toBeDisabled();
    expect(screen.getByText("Parse becomes available after a PDF is persisted from Documents.")).toBeInTheDocument();
  });

  it("keeps Parse, Chunking, and Embeddings actions disabled with explicit upstream reasons", () => {
    renderWithPipeline(<ParseScreen />);
    expect(screen.getByRole("heading", { name: "Parse" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reparse" })).toBeDisabled();
    expect(screen.getByText("A persisted document is required before reparsing.")).toBeInTheDocument();

    cleanup();
    renderWithPipeline(<ChunkingScreen />);
    expect(screen.getByRole("button", { name: "Create chunks" })).toBeDisabled();
    expect(screen.getByText("A persisted document and parse run are required first.")).toBeInTheDocument();

    cleanup();
    renderWithPipeline(<EmbeddingsScreen />);
    expect(screen.getByRole("button", { name: "Create embeddings" })).toBeDisabled();
    expect(screen.getByText("A successful, current chunk run is required first.")).toBeInTheDocument();
  });

  it("keeps the Playground route available even when no embedding is selected", () => {
    renderWithPipeline(<PipelineContextBar />);
    expect(screen.getByTestId("pipeline-context-bar")).toBeInTheDocument();
    expect(screen.getByText("No active document")).toBeInTheDocument();
  });
});
