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

describe("Phase 6B pipeline IA", () => {
  it("renders Documents as the document library with one Add PDF owner", () => {
    renderWithPipeline(<DocumentsScreen />);

    expect(screen.getByRole("heading", { name: "Documents", level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId("document-upload-panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add PDF" })).toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-context-bar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Parse|Reparse/i })).not.toBeInTheDocument();
  });

  it("keeps Parse, Chunking, and Embeddings actions disabled with explicit upstream reasons", () => {
    renderWithPipeline(<ParseScreen />);
    expect(screen.getByRole("heading", { name: "Parse", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Parse" })).toBeDisabled();
    expect(screen.getByText("Select a persisted document before parsing.")).toBeInTheDocument();

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
