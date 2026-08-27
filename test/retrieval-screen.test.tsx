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
  it("exposes the compact controls and one truthful blocker state", () => {
    renderRetrieval();

    expect(screen.getByRole("textbox", { name: "Question" })).toHaveAccessibleName("Question");
    const run = screen.getByRole("button", { name: "Run experiment" });
    expect(run).toBeDisabled();
    expect(run).toHaveAccessibleDescription("Select a document and complete indexing setup first.");
    expect(screen.getByTestId("playground-blocker")).toHaveTextContent("Action blocked");
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
    expect(screen.getByTestId("playground-blocker")).toHaveTextContent("Select a document");
  });
});
