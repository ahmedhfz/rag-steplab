import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreferencesProvider } from "@/components/preferences-provider";
import { NotFoundScreen, RouteErrorScreen } from "@/components/route-fallback";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Route fallbacks", () => {
  it("names an unknown route and links back to Overview", async () => {
    const notFound = await import("@/app/not-found");
    expect(notFound.metadata.title).toBe("Page not found");
    render(<PreferencesProvider><NotFoundScreen /></PreferencesProvider>);

    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Overview" })).toHaveAttribute("href", "/");
    await waitFor(() => expect(document.title).toBe("Page not found · RAG StepLab"));
  });

  it("follows the Turkish interface", async () => {
    localStorage.setItem("rag-steplab.preferences.v3", JSON.stringify({ locale: "tr", showLearningHints: true, theme: "system" }));
    render(<PreferencesProvider><NotFoundScreen /></PreferencesProvider>);

    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Sayfa bulunamadı" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Genel Bakış'a git" })).toHaveAttribute("href", "/");
    await waitFor(() => expect(document.title).toBe("Sayfa bulunamadı · RAG StepLab"));
  });

  it("offers retry first on a page error and keeps the digest for diagnostics", () => {
    const retry = vi.fn();
    render(<PreferencesProvider><RouteErrorScreen digest="digest-123" onRetry={retry} /></PreferencesProvider>);

    expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Go to Overview" })).toHaveAttribute("href", "/");
    expect(screen.getByText("digest-123")).toBeInTheDocument();
  });
});
