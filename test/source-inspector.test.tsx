import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const preview = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/rag-api", () => ({ getDocumentSourcePreviewUrl: preview.get }));

import { SourceInspector } from "@/components/source-inspector";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("SourceInspector", () => {
  it("shows real page evidence first and can retry a failed PDF preview", async () => {
    const user = userEvent.setup();
    preview.get.mockRejectedValueOnce(new Error("internal object storage error"));
    preview.get.mockResolvedValueOnce({ sourceUrl: "blob:http://localhost/source-pdf", revoke: vi.fn() });
    render(<SourceInspector documentId="doc-1" pageNumbers={[2]} parseResult={null} />);

    await user.click(screen.getByRole("button", { name: "Kaynağı incele" }));
    const evidence = screen.getByTestId("source-inspector-evidence");
    expect(evidence).toHaveTextContent("Kaynak kanıtı");
    expect(evidence).toHaveTextContent("Sayfa 2");
    expect(evidence).not.toHaveTextContent("Citation");
    expect(await screen.findByRole("alert")).toHaveTextContent("Kaynak PDF açılamadı");
    expect(screen.queryByText(/internal object storage/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tekrar dene" }));
    await waitFor(() => expect(screen.getByTitle("Kaynak denetleyicisi")).toHaveAttribute("src", "blob:http://localhost/source-pdf#page=2"));
    expect(preview.get).toHaveBeenCalledTimes(2);
  });
});
