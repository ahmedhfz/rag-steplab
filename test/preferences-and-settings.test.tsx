import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { PreferencesProvider } from "@/components/preferences-provider";
import { HowItWorks } from "@/components/ui/disclosure";
import { SettingsScreen } from "@/components/settings-screen";
import { PREFERENCES_STORAGE_KEY } from "@/lib/theme";

const STORAGE_KEY = PREFERENCES_STORAGE_KEY;

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
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

describe("PreferencesProvider and SettingsScreen", () => {
  it("keeps learning notes closed by default and reveals their content on demand", async () => {
    const user = userEvent.setup();
    render(
      <PreferencesProvider>
        <HowItWorks>Chunk size changes retrieval precision.</HowItWorks>
      </PreferencesProvider>,
    );

    const disclosure = screen.getByTestId("how-it-works");
    expect(disclosure.tagName).toBe("DETAILS");
    expect(disclosure).toHaveTextContent("How it works");
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByRole("note")).not.toBeVisible();

    await user.click(screen.getByText("How it works"));

    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByRole("note")).toBeVisible();
  });

  it("removes learning notes when the preference is disabled", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ locale: "en", showLearningHints: false, theme: "system" }));
    render(
      <PreferencesProvider>
        <HowItWorks>Hidden learning note.</HowItWorks>
      </PreferencesProvider>,
    );

    await waitFor(() => expect(screen.queryByTestId("how-it-works")).not.toBeInTheDocument());
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
      theme: "system",
    });
  });

  it("falls back to safe defaults when stored preferences are malformed", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ locale: "de", detailLevel: "verbose", showLearningHints: "yes" }));
    renderSettings();
    await waitForHydration();

    expect(screen.getByLabelText("English")).toBeChecked();
    expect(screen.getByLabelText("System")).toBeChecked();
    expect(screen.getByRole("switch", { name: "Show learning hints" })).toBeChecked();
  });

  it("keeps theme controls accessible in English and Turkish and resets to System", async () => {
    const user = userEvent.setup();
    renderSettings();
    await waitForHydration();

    await user.click(screen.getByLabelText("Dark"));
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    await user.click(screen.getByLabelText("Türkçe"));
    expect(screen.getByRole("radiogroup", { name: "Tema" })).toBeInTheDocument();
    expect(screen.getByLabelText("Sistem")).not.toBeChecked();
    expect(screen.getByLabelText("Koyu")).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Sıfırla" }));
    expect(screen.getByLabelText("System")).toBeChecked();
    expect(document.documentElement).not.toHaveClass("dark");
  });
});
