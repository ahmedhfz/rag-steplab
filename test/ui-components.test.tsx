import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { PreferencesProvider } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MetricValue } from "@/components/ui/metric";
import { Modal, ModalBody, ModalContent, ModalTrigger } from "@/components/ui/modal";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/tabs";

describe("design system components", () => {
  it("keeps legacy button variants addressable and blocks presses while loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick} variant="outline">Run</Button>);
    const button = screen.getByRole("button", { name: "Run" });
    expect(button).toHaveAttribute("data-variant", "outline");
    expect(button).toHaveAttribute("type", "button");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(<Button isLoading onClick={onClick}>Run</Button>);
    expect(screen.getByRole("button", { name: "Run" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Run" })).toHaveAttribute("data-variant", "default");
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("gives the segmented control radio semantics with arrow-key selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Harness() {
      const [value, setValue] = useState<"fixed" | "recursive">("fixed");
      return <SegmentedControl aria-label="Strategy" onChange={(next) => { setValue(next); onChange(next); }} options={[{ value: "fixed", label: "Fixed" }, { value: "recursive", label: "Recursive" }]} value={value} />;
    }
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "Strategy" });
    expect(within(group).getByRole("radio", { name: "Fixed" })).toBeChecked();
    await user.click(within(group).getByRole("radio", { name: "Fixed" }));
    await user.keyboard("{ArrowRight}");
    expect(within(group).getByRole("radio", { name: "Recursive" })).toBeChecked();
    expect(onChange).toHaveBeenLastCalledWith("recursive");
  });

  it("wires a field's label, hint and error to its control", () => {
    const { rerender } = render(<Field hint="Tokens per chunk" label="Chunk size"><Input /></Field>);
    const input = screen.getByRole("textbox", { name: "Chunk size" });
    expect(input).toHaveAccessibleDescription("Tokens per chunk");
    expect(input).not.toHaveAttribute("aria-invalid");

    rerender(<Field error="Too large" hint="Tokens per chunk" label="Chunk size"><Input /></Field>);
    expect(screen.getByRole("textbox", { name: "Chunk size" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox", { name: "Chunk size" })).toHaveAccessibleDescription("Too large");
  });

  it("speaks one status language, with an accessible label when icon-only", () => {
    render(<><StatusBadge status="processing">Embedding</StatusBadge><StatusBadge appearance="icon" status="stale">Stale</StatusBadge></>);
    expect(screen.getByText("Embedding").closest("[data-status]")).toHaveAttribute("data-status", "processing");
    expect(screen.getByText("Stale")).toHaveClass("sr-only");
    expect(screen.getByTitle("Stale")).toHaveAttribute("data-status", "stale");
  });

  it("switches tabs with tab semantics", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultSelectedKey="a">
        <TabList aria-label="Views"><Tab id="a">Dataset</Tab><Tab id="b">Results</Tab></TabList>
        <TabPanel id="a">Dataset panel</TabPanel>
        <TabPanel id="b">Results panel</TabPanel>
      </Tabs>,
    );
    expect(screen.getByRole("tab", { name: "Dataset" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Results" }));
    expect(screen.getByRole("tab", { name: "Results" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Results panel");
  });

  it("opens a modal named by its title", async () => {
    const user = userEvent.setup();
    render(
      <PreferencesProvider>
        <Modal>
          <ModalTrigger asChild><Button>Rename</Button></ModalTrigger>
          <ModalContent description="Shown in every run." title="Rename pipeline"><ModalBody>Body</ModalBody></ModalContent>
        </Modal>
      </PreferencesProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename pipeline" });
    expect(dialog).toHaveAccessibleDescription("Shown in every run.");
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("shows a placeholder instead of animating a missing metric", () => {
    render(<PreferencesProvider><MetricValue data-testid="metric" value={null} /></PreferencesProvider>);
    expect(screen.getByTestId("metric")).toHaveTextContent("—");
    expect(screen.getByTestId("metric")).toHaveClass("tabular-nums");
  });
});
