import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { PreferencesProvider } from "@/components/preferences-provider";
import { RetrievalScreen } from "@/components/retrieval-screen";
import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";

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
});

describe("RetrievalScreen", () => {
  it("exposes labelled controls, disabled backend actions, reasons, and truthful empty states", () => {
    renderRetrieval();

    expect(screen.getByRole("textbox", { name: "Question" })).toHaveAccessibleName("Question");
    const run = screen.getByRole("button", { name: "Run experiment" });
    expect(run).toBeDisabled();
    expect(run).toHaveAccessibleDescription("Select a persisted document and complete chunking first.");
    expect(screen.getByTestId("playground-blocker")).toHaveTextContent("Action blocked");
    expect(screen.getByTestId("playground-blocker")).toHaveTextContent("Go to Documents");
    expect(screen.getByRole("button", { name: "Hybrid" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Advanced settings")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Copy trace" })).not.toBeInTheDocument();

    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset).toBeDisabled();
    expect(reset).toHaveAccessibleDescription("No query settings have changed.");
    expect(screen.getAllByText("No real retrieval experiment has run yet.").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("No trace data is available yet.")).toBeInTheDocument();
  });

  it("allows request parameters to be prepared and reset without running fake retrieval", async () => {
    const user = userEvent.setup();
    renderRetrieval();

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
    expect(screen.getAllByText("No real retrieval experiment has run yet.").length).toBeGreaterThanOrEqual(1);
  });
});
