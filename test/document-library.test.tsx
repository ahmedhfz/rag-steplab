import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const LONG_NAME = "Karaman_RAG_StepLab_long_filename_for_single_line_select_geometry_validation-2026.pdf";

const pipeline = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("@/components/document-pipeline-provider", () => ({
  useDocumentPipeline: () => pipeline.value,
}));

import { DocumentLibrary } from "@/components/document-library";
import { PreferencesProvider } from "@/components/preferences-provider";

function documentItem(id: string, fileName: string) {
  return { id, fileName, mediaType: "application/pdf", sizeBytes: 1536, pageCount: 8, sha256: id, activeParseRunId: null, activeChunkRunId: null, activeEmbeddingRunId: null, latestParseStatus: "completed", latestParseError: null, createdAt: "2026-08-24T10:00:00Z", updatedAt: null };
}

afterEach(() => {
  cleanup();
});

describe("Document library layout", () => {
  it("truncates a long file name inside its own column and keeps the In use badge intact", () => {
    pipeline.value = {
      documents: [documentItem("document-long", LONG_NAME), documentItem("document-short", "short.pdf")],
      activeDocumentId: "document-long",
      persistenceStatus: "available",
      persistenceError: null,
      selectPersistedDocument: vi.fn(),
      deletePersistedDocument: vi.fn(),
    };
    render(<PreferencesProvider><DocumentLibrary /></PreferencesProvider>);

    const table = screen.getByTestId("document-library-table");
    // Fixed table layout: the name column cannot push Pages/Size aside.
    expect(table.querySelector("table")).toHaveClass("table-fixed");
    const [row] = within(table).getAllByTestId("document-library-row");
    const name = within(row).getByTestId("document-library-name");
    expect(name).toHaveTextContent(LONG_NAME);
    expect(name).toHaveClass("truncate", "min-w-0");
    expect(name.closest("button")).toHaveAttribute("title", LONG_NAME);
    const badge = within(row).getByText("In use").closest("[data-slot='badge']");
    expect(badge).toHaveClass("shrink-0");
    expect(within(row).getByRole("cell", { name: "8" })).toBeInTheDocument();
    // The redundant "PDF" sub-label is gone (only PDFs are supported).
    expect(within(row).queryByText("PDF", { exact: true })).not.toBeInTheDocument();

    // Mobile: the name wraps after separators instead of mid-word.
    const mobile = within(screen.getByTestId("document-library-mobile")).getAllByTitle(LONG_NAME)[0];
    expect(mobile.querySelectorAll("wbr").length).toBeGreaterThan(5);
    expect(mobile).toHaveTextContent(LONG_NAME);
  });

  it("states the library size with a correct plural and links the next step", () => {
    pipeline.value = {
      documents: [documentItem("document-one", "one.pdf")],
      activeDocumentId: "document-one",
      persistenceStatus: "available",
      persistenceError: null,
      selectPersistedDocument: vi.fn(),
      deletePersistedDocument: vi.fn(),
    };
    render(<PreferencesProvider><DocumentLibrary /></PreferencesProvider>);
    expect(screen.getByText("1 document")).toBeInTheDocument();
    expect(screen.getByTestId("documents-continue-action")).toHaveAttribute("href", "/parse");
    expect(screen.getByTestId("documents-continue-action")).toHaveTextContent("Continue to Parsing");
  });
});
