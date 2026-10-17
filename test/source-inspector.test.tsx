import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
    // The shared error notice names the failure; the raw cause stays under Technical details only.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Kaynak PDF açılamadı");
    expect(alert).toHaveAttribute("data-slot", "notice");
    const details = within(alert).getByTestId("api-error-details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("internal object storage error");
    expect(alert.textContent?.replace(details.textContent ?? "", "")).not.toContain("internal object storage");

    await user.click(screen.getByRole("button", { name: "Tekrar dene" }));
    await waitFor(() => expect(screen.getByTitle("Kaynak denetleyicisi")).toHaveAttribute("src", "blob:http://localhost/source-pdf#page=2"));
    expect(preview.get).toHaveBeenCalledTimes(2);
  });

  it("still names a failure that carries no cause, without empty Technical details", async () => {
    const user = userEvent.setup();
    preview.get.mockRejectedValueOnce("offline");
    render(<SourceInspector documentId="doc-1" pageNumbers={[2]} parseResult={null} />);

    await user.click(screen.getByRole("button", { name: "Kaynağı incele" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Kaynak PDF açılamadı.");
    expect(within(alert).queryByTestId("api-error-details")).not.toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Tekrar dene" })).toBeInTheDocument();
  });

  it("names the icon-only trigger and still opens the inspector", async () => {
    const user = userEvent.setup();
    preview.get.mockRejectedValueOnce(new Error("not needed"));
    render(<SourceInspector documentId="doc-1" pageNumbers={[2]} parseResult={null} triggerAriaLabel="Kaynağı incele: Bölüm 1" triggerLabel="Kaynağı görüntüle" variant="icon" />);

    const trigger = screen.getByRole("button", { name: "Kaynağı incele: Bölüm 1" });
    expect(trigger).not.toHaveTextContent("Kaynağı görüntüle");
    await user.click(trigger);
    expect(await screen.findByRole("dialog", { name: "Kaynak denetleyicisi" })).toBeInTheDocument();
  });
});
