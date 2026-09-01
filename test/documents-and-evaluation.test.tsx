import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";

import { DocumentsScreen } from "@/components/documents-screen";
import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { EvaluationScreen } from "@/components/evaluation-screen";
import { ParseScreen } from "@/components/parse-screen";
import { PreferencesProvider } from "@/components/preferences-provider";

function renderScreen(screenToRender: React.ReactNode) {
  return render(<PreferencesProvider><DocumentPipelineProvider>{screenToRender}</DocumentPipelineProvider></PreferencesProvider>);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("DocumentsScreen", () => {
  it("keeps document management separate from parsing", async () => {
    renderScreen(<DocumentsScreen />);

    expect(screen.getByRole("heading", { name: "Documents", level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId("pdf-drop-zone")).toHaveAttribute("type", "button");
    expect(screen.getByLabelText("Choose PDF")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add PDF" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("pipeline-context-bar")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Parse|Reparse/i })).not.toBeInTheDocument();
  });

  it("keeps parse output and parse mutation on Parse", () => {
    renderScreen(<ParseScreen />);

    expect(screen.getByRole("heading", { name: "Parsing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Parse" })).toBeDisabled();
    expect(screen.getByRole("group", { name: "Parsed content view mode" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Structured" })).toBeDisabled();
  });

  it("does not issue document detail fetches while Documents is empty", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderScreen(<DocumentsScreen />);
    await waitFor(() => expect(screen.getByText("The document service is unavailable.")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/documents/"))).toBe(false);
  });
});

describe("EvaluationScreen", () => {
  it("states why evaluation is empty without inventing metrics", () => {
    renderScreen(<EvaluationScreen />);

    expect(screen.getByRole("heading", { name: "Evaluation" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Dataset" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("Create a dataset after the active document has current chunks and embeddings, then run a real evaluation.").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Recall|Precision|MRR|accuracy/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create dataset" })).toBeDisabled();

    const user = userEvent.setup();
    return user.click(screen.getByRole("tab", { name: "Results" })).then(() => {
      expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("heading", { name: "No evaluation data yet" })).toBeInTheDocument();
      expect(screen.getByTestId("evaluation-reranker-control")).toHaveTextContent("Off");
      expect(screen.getByRole("button", { name: "Run evaluation" })).toBeDisabled();
    });
  });
});
