import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PreferencesProvider } from "@/components/preferences-provider";
import { StageBlocker } from "@/components/stage-blocker";
import { Disclosure, TechnicalDetails } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PIPELINE_STEP_STATUS, StatusIcon, StatusPill } from "@/components/ui/status-pill";
import { getPipelineAvailability } from "@/lib/blockers";

describe("design system primitives", () => {
  it("renders a single page title without an eyebrow or fixed height", () => {
    render(<PageHeader actions={<button type="button">Act</button>} data-testid="header" description="One line." title="Documents" />);
    const header = screen.getByTestId("header");
    expect(within(header).getByRole("heading", { level: 1, name: "Documents" })).toBeInTheDocument();
    expect(within(header).getByText("One line.")).toBeInTheDocument();
    expect(header.className).not.toMatch(/\bh-\[/);
    expect(header.querySelectorAll("p")).toHaveLength(1);
  });

  it("owns the disclosure chevron and native toggle for both variants", async () => {
    const user = userEvent.setup();
    render(<PreferencesProvider><Disclosure data-testid="section" meta={3} title="Run history">rows</Disclosure><TechnicalDetails data-testid="technical">id-123</TechnicalDetails></PreferencesProvider>);
    const section = screen.getByTestId("section");
    expect(section.tagName).toBe("DETAILS");
    expect(section).toHaveAttribute("data-variant", "section");
    expect(within(section).getByText("3")).toBeInTheDocument();
    expect(section.querySelector("summary .t-acc-chevron")).not.toBeNull();
    expect(section).not.toHaveAttribute("open");
    await user.click(within(section).getByText("Run history"));
    expect(section).toHaveAttribute("open");
    const technical = screen.getByTestId("technical");
    expect(technical).toHaveAttribute("data-variant", "inline");
    expect(within(technical).getByText("Technical details")).toBeInTheDocument();
  });

  it("keeps completed status neutral and reserves the brand tone for the next step", () => {
    expect(PIPELINE_STEP_STATUS.Completed.tone).toBe("neutral");
    expect(PIPELINE_STEP_STATUS.Ready.tone).toBe("next");
    expect(PIPELINE_STEP_STATUS.Locked.tone).toBe("idle");
    expect(Object.entries(PIPELINE_STEP_STATUS).filter(([, value]) => value.tone === "next").map(([state]) => state)).toEqual(["Ready"]);
    render(<><StatusIcon label="Completed" tone="neutral" /><StatusPill tone="running">Processing</StatusPill></>);
    expect(screen.getByText("Completed")).toHaveClass("sr-only");
    expect(screen.getByTitle("Completed")).toHaveAttribute("data-tone", "neutral");
    expect(screen.getByText("Processing").closest("[data-tone]")).toHaveAttribute("data-tone", "running");
  });

  it("explains a missing prerequisite neutrally with a link to the unblocking step", () => {
    const missingParse = getPipelineAvailability("en", "chunk", { document: { id: "doc" }, persistenceStatus: "available", workspaceStatus: "ready" });
    const { rerender } = render(<StageBlocker blocker={missingParse} data-testid="blocker" />);
    const blocker = screen.getByTestId("blocker");
    expect(blocker).toHaveAttribute("role", "status");
    expect(blocker).toHaveClass("text-muted-foreground");
    expect(within(blocker).getByRole("link", { name: /Parse the document/ })).toHaveAttribute("href", "/parse");

    rerender(<StageBlocker blocker={getPipelineAvailability("en", "chunk", { workspaceStatus: "unavailable" })} data-testid="blocker" />);
    expect(screen.getByTestId("blocker")).toHaveClass("text-destructive");

    rerender(<StageBlocker blocker={getPipelineAvailability("en", "chunk", { workspaceStatus: "loading" })} data-testid="blocker" />);
    expect(screen.queryByTestId("blocker")).not.toBeInTheDocument();
  });

  it("renders a calm empty state with an optional action", () => {
    render(<EmptyState action={<button type="button">Add PDF</button>} description="Add your first PDF." icon="document" title="No documents yet." titleAs="h2" />);
    expect(screen.getByRole("heading", { level: 2, name: "No documents yet." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add PDF" })).toBeInTheDocument();
  });
});
