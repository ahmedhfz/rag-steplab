import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { PreferencesProvider } from "@/components/preferences-provider";
import { LearningHint } from "@/components/pipeline-learning-ui";
import { SettingsScreen } from "@/components/settings-screen";

const STORAGE_KEY = "rag-steplab.preferences.v2";

function renderSettings() {
  return render(
    <PreferencesProvider>
      <SettingsScreen />
    </PreferencesProvider>,
  );
}

async function waitForHydration() {
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Changes are saved automatically."));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.lang = "en";
});

describe("PreferencesProvider and SettingsScreen", () => {
  it("keeps learning notes closed by default and reveals their content on demand", async () => {
    const user = userEvent.setup();
    render(
      <PreferencesProvider>
        <LearningHint locale="en">Chunk size changes retrieval precision.</LearningHint>
      </PreferencesProvider>,
    );

    const disclosure = screen.getByText("Why this matters").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByRole("note")).not.toBeVisible();

    await user.click(screen.getByText("Why this matters"));

    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByRole("note")).toBeVisible();
  });

  it("removes learning notes when the preference is disabled", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ locale: "en", showLearningHints: false }));
    render(
      <PreferencesProvider>
        <LearningHint locale="en">Hidden learning note.</LearningHint>
      </PreferencesProvider>,
    );

    await waitFor(() => expect(screen.queryByText("Why this matters")).not.toBeInTheDocument());
    expect(screen.queryByText("Hidden learning note.")).not.toBeInTheDocument();
  });

  it("persists the selected language, updates document language, and restores it on a new route render", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSettings();
    await waitForHydration();

    await user.click(screen.getByLabelText("Türkçe"));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Ayarlar" })).toBeInTheDocument();
      expect(document.documentElement).toHaveAttribute("lang", "tr");
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({ locale: "tr" });

    unmount();
    renderSettings();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Ayarlar" })).toBeInTheDocument());
    expect(screen.getByLabelText("Türkçe")).toBeChecked();
    expect(screen.getByLabelText("English")).not.toBeChecked();
  });

  it("keeps settings controls labelled, resets changed preferences, and exposes the disabled reason", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitForHydration();

    const reset = screen.getByRole("button", { name: "Reset" });
    expect(reset).toBeDisabled();
    expect(screen.getByText("Preferences already use the defaults.")).toBeVisible();
    expect(reset).toHaveAccessibleDescription("Preferences already use the defaults.");

    await user.click(screen.getByRole("switch", { name: "Show learning hints" }));
    expect(screen.getByRole("switch", { name: "Show learning hints" })).not.toBeChecked();
    expect(reset).toBeEnabled();

    await user.click(reset);
    expect(screen.getByRole("switch", { name: "Show learning hints" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      locale: "en",
      showLearningHints: true,
    });
  });

  it("falls back to safe defaults when stored preferences are malformed", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ locale: "de", detailLevel: "verbose", showLearningHints: "yes" }));
    renderSettings();
    await waitForHydration();

    expect(screen.getByLabelText("English")).toBeChecked();
    expect(screen.getByRole("switch", { name: "Show learning hints" })).toBeChecked();
  });
});
