import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { DocumentsScreen } from "@/components/documents-screen";
import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { EvaluationScreen } from "@/components/evaluation-screen";
import { PreferencesProvider } from "@/components/preferences-provider";

function renderScreen(screenToRender: React.ReactNode) {
  return render(<PreferencesProvider><DocumentPipelineProvider>{screenToRender}</DocumentPipelineProvider></PreferencesProvider>);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("DocumentsScreen", () => {
  it("keeps document routes discoverable and marks the active tab", () => {
    renderScreen(<DocumentsScreen view="parsed" />);

    expect(screen.getByRole("heading", { name: "Parsed Content" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/documents");
    expect(screen.getByRole("link", { name: "Parsed Content" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Chunks" })).toHaveAttribute("href", "/documents/chunks");
    expect(screen.getByText("No pages are available until parsing completes.")).toBeInTheDocument();
    expect(screen.getByText("Select a parsed page to inspect its elements.")).toBeInTheDocument();
  });

  it("exposes the unavailable parsed-view controls as a labelled disabled group", () => {
    renderScreen(<DocumentsScreen view="parsed" />);

    const viewGroup = screen.getByRole("group", { name: "Parsed content view mode" });
    expect(viewGroup).toHaveAccessibleDescription("Views become available after a real parse completes.");
    expect(screen.getByRole("button", { name: "Structured" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Structured" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Markdown" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "JSON" })).toBeDisabled();
  });

  it("shows the document empty state and preserves route navigation", async () => {
    const user = userEvent.setup();
    renderScreen(<DocumentsScreen view="overview" />);

    expect(screen.getByRole("heading", { name: "Document Overview" })).toBeInTheDocument();
    const chooseFromOverview = screen.getByRole("link", { name: /Choose a PDF from Overview/ });
    expect(chooseFromOverview).toHaveAttribute("href", "/");
    expect(screen.getByText("No document is available yet.")).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveFocus();
  });
});

describe("EvaluationScreen", () => {
  it("states why evaluation is empty without inventing metrics", () => {
    renderScreen(<EvaluationScreen />);

    expect(screen.getByRole("heading", { name: "Evaluation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No evaluation data yet" })).toBeInTheDocument();
    expect(screen.getAllByText("Create a dataset after the active document has current chunks and embeddings, then run a real evaluation.").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Recall|Precision|MRR|accuracy/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create dataset" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run evaluation" })).toBeDisabled();
  });
});
