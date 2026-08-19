import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DocumentPipelineProvider } from "@/components/document-pipeline-provider";
import { OverviewScreen } from "@/components/overview-screen";
import { PreferencesProvider } from "@/components/preferences-provider";

function renderOverview() {
  return render(
    <PreferencesProvider>
      <DocumentPipelineProvider><OverviewScreen /></DocumentPipelineProvider>
    </PreferencesProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Overview PDF selection", () => {
  it("selects and removes a PDF without starting parsing automatically", async () => {
    const user = userEvent.setup();
    renderOverview();
    const input = screen.getByLabelText("Choose PDF");
    const file = new File(["%PDF-1.4"], "learning-notes.pdf", { type: "application/pdf" });

    await user.upload(input, file);

    expect(await screen.findByText("learning-notes.pdf")).toBeInTheDocument();
    expect(screen.getAllByText("Document selected").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Parse Document" })).toBeEnabled();
    expect(screen.getByText("Click Parse Document to start the real FastAPI → Docling request.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove selected document" }));

    await waitFor(() => expect(screen.queryByText("learning-notes.pdf")).not.toBeInTheDocument());
    expect(await screen.findByText("No document selected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose PDF" })).toHaveFocus();
  });

  it("sends the selected PDF and renders the real parse lifecycle", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      document: { fileName: "learning-notes.pdf", mediaType: "application/pdf", sizeBytes: 9, pageCount: 1 },
      structured: {
        pages: [{ pageNumber: 1, elements: [{ id: "element-1", type: "heading", pageNumbers: [1], text: "Lesson", level: 1, table: null }] }],
        elements: [{ id: "element-1", type: "heading", pageNumbers: [1], text: "Lesson", level: 1, table: null }],
      },
      markdown: "# Lesson",
      summary: { pageCount: 1, headingCount: 1, paragraphCount: 0, listCount: 0, tableCount: 0 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderOverview();
    const input = screen.getByLabelText("Choose PDF");
    const file = new File(["%PDF-1.4"], "learning-notes.pdf", { type: "application/pdf" });

    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "Parse Document" }));

    await waitFor(() => expect(screen.getByText("Parse completed")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8000/documents/parse", expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    expect(screen.getByText("Pages")).toBeInTheDocument();
    expect(screen.getByText("Parse completed. You can inspect the returned content or run parsing again.")).toBeInTheDocument();
    expect(screen.getByTestId("activity-timeline")).toHaveAttribute("data-state", "completed");
    expect(screen.getByTestId("activity-timeline").querySelector('[data-activity-type="parseCompleted"]')).toHaveAttribute("data-activity-status", "completed");
  });

  it("shows a backend-unavailable error without inventing parse data", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderOverview();
    const input = screen.getByLabelText("Choose PDF");
    const file = new File(["%PDF-1.4"], "offline.pdf", { type: "application/pdf" });

    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "Parse Document" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The parsing backend could not be reached.");
    expect(screen.getByText("Parse failed")).toBeInTheDocument();
    expect(screen.getByText("No parse summary is available until a backend parser returns structured content.")).toBeInTheDocument();
    expect(screen.getByTestId("activity-timeline")).toHaveAttribute("data-state", "error");
    expect(screen.getByTestId("activity-timeline").querySelector('[data-activity-type="parseFailed"]')).toHaveAttribute("data-activity-status", "error");
  });

  it("rejects an invalid local file with a visible validation error", () => {
    renderOverview();
    const input = screen.getByLabelText("Choose PDF");
    const file = new File(["plain text"], "notes.txt", { type: "text/plain" });

    fireEvent.change(input, { target: { files: [file] } });

    expect(screen.getByRole("alert")).toHaveTextContent("Only PDF files are supported.");
    expect(screen.getByText("No document selected.")).toBeInTheDocument();
  });

  it("supports drag-active feedback and PDF drop selection", async () => {
    renderOverview();
    const dropZone = screen.getByRole("group", { name: "Upload Document" });
    const file = new File(["%PDF-1.4"], "dropped.pdf", { type: "application/pdf" });

    fireEvent.dragEnter(dropZone, { dataTransfer: { files: [file] } });
    expect(dropZone).toHaveAttribute("data-state", "drag-active");

    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByText("dropped.pdf")).toBeInTheDocument());
    expect(dropZone).toHaveAttribute("data-state", "idle");
  });
});
