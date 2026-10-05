import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SlidingTabs, TransitionDetails, TransitionPanel, TransitionSurface, TransitionText } from "@/components/ui/transitions";
import { transitionMs } from "@/lib/transitions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

afterEach(() => { cleanup(); vi.useRealTimers(); document.documentElement.style.removeProperty("--panel-close-dur"); });

describe("transitions.dev state adapters", () => {
  it("keeps native details and nested disclosures independent", async () => {
    const user = userEvent.setup();
    render(<TransitionDetails><summary>History</summary><TransitionDetails><summary>Technical ID</summary><p>run-123</p></TransitionDetails></TransitionDetails>);
    const outer = screen.getByText("History").closest("details")!;
    const inner = screen.getByText("Technical ID").closest("details")!;
    await user.click(screen.getByText("History"));
    await waitFor(() => expect(outer).toHaveAttribute("data-open", "true"));
    expect(inner).not.toHaveAttribute("open");
    expect(inner.querySelector(":scope > .t-acc-panel")).toHaveAttribute("inert");
    await user.click(screen.getByText("Technical ID"));
    await waitFor(() => expect(inner).toHaveAttribute("data-open", "true"));
    expect(inner.querySelector(":scope > .t-acc-panel")).not.toHaveAttribute("inert");
    await user.click(screen.getByText("History"));
    await waitFor(() => expect(outer.querySelector(":scope > .t-acc-panel")).toHaveAttribute("inert"));
  });

  it("reflects externally controlled details without delaying its state", () => {
    const { container, rerender } = render(<TransitionDetails open><summary>Config</summary><button>Change</button></TransitionDetails>);
    rerender(<TransitionDetails open={false}><summary>Config</summary><button>Change</button></TransitionDetails>);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(container.querySelector(".t-acc-panel")).toHaveAttribute("inert");
  });

  it("disables a closing surface immediately and cancels its cleanup on reopen", () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--panel-close-dur", "350ms");
    const view = (open: boolean) => <TransitionSurface kind="panel" open={open}><button>Action</button></TransitionSurface>;
    const { container, rerender } = render(view(true));
    rerender(view(false));
    expect(container.firstElementChild).toHaveAttribute("inert");
    act(() => { vi.advanceTimersByTime(100); });
    rerender(view(true));
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByRole("button", { name: "Action" })).toBeVisible();
    expect(container.firstElementChild).not.toHaveAttribute("inert");
    rerender(view(false));
    act(() => { vi.advanceTimersByTime(350); });
    expect(container).toBeEmptyDOMElement();
  });

  it("removes stale result content immediately instead of retaining an exit", () => {
    const { rerender } = render(<TransitionPanel transitionKey="run-a"><p>Old result</p></TransitionPanel>);
    rerender(<TransitionPanel transitionKey="run-b"><p>Current result</p></TransitionPanel>);
    expect(screen.queryByText("Old result")).not.toBeInTheDocument();
    expect(screen.getByText("Current result")).toBeVisible();
  });

  it("updates status text immediately and keeps its live-region content", () => {
    const { rerender } = render(<p role="status"><TransitionText>Processing</TransitionText></p>);
    rerender(<p role="status"><TransitionText>Completed</TransitionText></p>);
    expect(screen.getByRole("status")).toHaveTextContent("Completed");
    expect(screen.queryByText("Processing")).not.toBeInTheDocument();
  });

  it("measures the actual selected control and preserves button semantics", () => {
    const { container, rerender } = render(<SlidingTabs value="a"><button aria-pressed>A</button><button aria-pressed={false}>B</button></SlidingTabs>);
    const second = screen.getByRole("button", { name: "B" });
    Object.defineProperties(second, { offsetLeft: { configurable: true, value: 72 }, offsetWidth: { configurable: true, value: 64 }, offsetHeight: { configurable: true, value: 36 } });
    rerender(<SlidingTabs value="b"><button aria-pressed={false}>A</button><button aria-pressed>B</button></SlidingTabs>);
    expect(container.querySelector(".t-tabs-pill")).toHaveStyle({ transform: "translate(72px, 0px)", width: "64px", height: "36px" });
    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-pressed", "true");
  });

  it("reads durations in milliseconds and seconds from recipe variables", () => {
    document.documentElement.style.setProperty("--panel-close-dur", "0.35s");
    expect(transitionMs("--panel-close-dur", 150)).toBe(350);
    document.documentElement.style.setProperty("--panel-close-dur", "250ms");
    expect(transitionMs("--panel-close-dur", 150)).toBe(250);
  });

  it("attaches dropdown motion when an initially closed Radix select mounts its portal", async () => {
    render(<Select defaultValue="a"><SelectTrigger aria-label="Document"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="a">First</SelectItem><SelectItem value="b">Second</SelectItem></SelectContent></Select>);
    const trigger = screen.getByRole("combobox", { name: "Document" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const list = await screen.findByRole("listbox");
    expect(list).toHaveClass("t-dropdown", "is-open");
    expect(list).not.toHaveAttribute("inert");
    fireEvent.keyDown(list, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(await screen.findByRole("listbox")).toHaveClass("is-open");
  });
});
