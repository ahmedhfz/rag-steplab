import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { PreferencesProvider } from "@/components/preferences-provider";
import { RetrievalScreen } from "@/components/retrieval-screen";

function renderRetrieval() {
  return render(
    <PreferencesProvider>
      <RetrievalScreen />
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
    expect(screen.getByRole("combobox", { name: "Top-K" })).toHaveTextContent("5");
    expect(screen.getByRole("combobox", { name: "Mode" })).toHaveTextContent("Dense");

    const ask = screen.getByRole("button", { name: "Ask" });
    expect(ask).toBeDisabled();
    expect(ask).toHaveAccessibleDescription("Ask is disabled until a retrieval backend and indexed content are connected.");

    const reranker = screen.getByRole("combobox", { name: "Reranker" });
    expect(reranker).toBeDisabled();
    expect(reranker).toHaveAccessibleDescription("Reranker options become available after retrieval is connected.");

    const copyTrace = screen.getByRole("button", { name: "Copy trace" });
    expect(copyTrace).toBeDisabled();
    expect(copyTrace).toHaveAccessibleDescription("Trace data will be available after a real retrieval run.");

    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset).toBeDisabled();
    expect(reset).toHaveAccessibleDescription("No query settings have changed.");
    expect(screen.getByText("No retrieval results are available yet.")).toBeInTheDocument();
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

    await user.click(screen.getByRole("combobox", { name: "Top-K" }));
    await user.click(screen.getByRole("option", { name: "10" }));
    await user.click(screen.getByRole("combobox", { name: "Mode" }));
    await user.click(screen.getByRole("option", { name: "Hybrid" }));
    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset).toBeEnabled();

    await user.click(reset);
    expect(question).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Top-K" })).toHaveTextContent("5");
    expect(screen.getByRole("combobox", { name: "Mode" })).toHaveTextContent("Dense");
    expect(reset).toBeDisabled();
    expect(screen.getByText("No retrieval results are available yet.")).toBeInTheDocument();
  });
});
