import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigationState = vi.hoisted(() => ({ pathname: "/" }));
const authMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, prefetch, ...props }: { children: React.ReactNode; href: string; prefetch?: boolean }) => (
    <a data-prefetch={String(prefetch)} href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      getUser: authMocks.getUser,
      onAuthStateChange: authMocks.onAuthStateChange,
      signOut: authMocks.signOut,
    },
  }),
}));

import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { PreferencesProvider } from "@/components/preferences-provider";

function renderShell(pathname: string) {
  navigationState.pathname = pathname;
  return render(
    <PreferencesProvider>
      <AuthProvider><AppShell><p>Page content</p></AppShell></AuthProvider>
    </PreferencesProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.title = "";
});

function shellTree(content: string) {
  return (
    <PreferencesProvider>
      <AuthProvider><AppShell><p>{content}</p></AppShell></AuthProvider>
    </PreferencesProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.getUser.mockResolvedValue({
    data: {
      user: {
        email: "ahmed@example.com",
        user_metadata: { full_name: "Ahmed Hafızoğlu" },
      },
    },
  });
  authMocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  authMocks.signOut.mockResolvedValue({ error: null });
});

describe("AppShell navigation contract", () => {
  it("renders the grouped navigation in order", () => {
    renderShell("/documents");
    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    // One taxonomy everywhere: Prepare · Test · Measure (Evaluation measures).
    expect(navigation).toHaveTextContent(/Overview[\s\S]*Prepare[\s\S]*Documents[\s\S]*Parsing[\s\S]*Chunking[\s\S]*Embeddings[\s\S]*Test[\s\S]*Playground[\s\S]*Measure[\s\S]*Evaluation[\s\S]*Settings/);
    expect(within(navigation).getByRole("link", { name: "Documents" })).toHaveAttribute("href", "/documents");
    expect(within(navigation).getByRole("link", { name: "Playground" })).toHaveAttribute("href", "/playground");
    expect(within(navigation).getAllByRole("link").every((link) => link.dataset.prefetch === "false")).toBe(true);
  });

  it("keeps the page content visible when the pathname changes in the same shell", () => {
    navigationState.pathname = "/documents";
    const { rerender } = render(
      <PreferencesProvider>
        <AuthProvider><AppShell><p>Document overview</p></AppShell></AuthProvider>
      </PreferencesProvider>,
    );

    navigationState.pathname = "/parse";
    rerender(
      <PreferencesProvider>
        <AuthProvider><AppShell><p>Parsed content</p></AppShell></AuthProvider>
      </PreferencesProvider>,
    );

    expect(screen.getByRole("main")).toHaveTextContent("Parsed content");
    expect(screen.getByText("Parsed content")).toBeVisible();
    expect(screen.getByRole("main").firstElementChild).not.toHaveAttribute("style");
  });

  it.each([
    ["/parse", "Parsing", "/parse"],
    ["/chunking", "Chunking", "/chunking"],
    ["/playground", "Playground", "/playground"],
  ])("marks the correct route as current for %s", (pathname, name, href) => {
    renderShell(pathname);

    const current = screen.getAllByRole("link", { name }).find((link) => link.getAttribute("aria-current") === "page");
    expect(current).toBeDefined();
    expect(current).toHaveAttribute("href", href);
  });

  it("opens and closes the mobile navigation with labelled controls", async () => {
    const user = userEvent.setup();
    renderShell("/");

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
    const closeButton = within(screen.getByRole("dialog", { name: "Primary navigation" })).getByRole("button", { name: "Close" });
    expect(closeButton).toHaveFocus();

    await user.click(closeButton);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument());
  });

  it("shows name-based initials and utility actions in the lower-left account menu", async () => {
    const user = userEvent.setup();
    renderShell("/");

    await waitFor(() => expect(screen.getByText("Ahmed Hafızoğlu")).toBeVisible());
    expect(authMocks.getUser).toHaveBeenCalledTimes(1);
    expect(screen.getByText("AH")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Ahmed Hafızoğlu — Account menu" }));
    const menu = screen.getByRole("group", { name: "Account menu" });

    await waitFor(() => expect(within(menu).getByRole("button", { name: "Help" })).toBeVisible());
    // The Guides panel only repeated three nav links; Help no longer repeats Settings (N-4).
    expect(within(menu).queryByRole("button", { name: "Guides" })).not.toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(within(menu).getByRole("button", { name: "Sign out" })).toBeVisible();

    await user.click(within(menu).getByRole("button", { name: "Help" }));
    expect(within(menu).getByText("About RAG StepLab")).toBeVisible();
    expect(within(menu).queryByText("Open settings")).not.toBeInTheDocument();
  });

  it("uses disclosure semantics for the account menu and keeps focus across its views", async () => {
    const user = userEvent.setup();
    renderShell("/");
    await waitFor(() => expect(screen.getByText("Ahmed Hafızoğlu")).toBeVisible());

    const trigger = screen.getByRole("button", { name: "Ahmed Hafızoğlu — Account menu" });
    expect(trigger).not.toHaveAttribute("aria-haspopup");
    expect(trigger).not.toHaveAttribute("aria-controls");
    await user.click(trigger);
    expect(screen.queryByRole("dialog", { name: "Account menu" })).not.toBeInTheDocument();
    const menu = screen.getByRole("group", { name: "Account menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-controls", menu.id);

    // Switching views unmounts the focused control; focus follows to its counterpart.
    await user.click(within(menu).getByRole("button", { name: "Help" }));
    expect(within(menu).getByRole("button", { name: "Back" })).toHaveFocus();
    await user.click(within(menu).getByRole("button", { name: "Back" }));
    expect(within(menu).getByRole("button", { name: "Help" })).toHaveFocus();

    await user.click(within(menu).getByRole("button", { name: "Help" }));
    await user.keyboard("{Escape}");
    expect(within(menu).getByRole("button", { name: "Help" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("offers a skip link to the main landmark", async () => {
    const user = userEvent.setup();
    renderShell("/documents");

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveAttribute("href", "#main-content");

    await user.click(skip);
    expect(main).toHaveFocus();
  });

  it("moves focus to the main landmark after a client route change, not on first load", () => {
    navigationState.pathname = "/documents";
    const { rerender } = render(shellTree("Documents page"));
    expect(screen.getByRole("main")).not.toHaveFocus();

    navigationState.pathname = "/parse";
    rerender(shellTree("Parsing page"));
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("makes the page behind the open mobile navigation inert", async () => {
    const user = userEvent.setup();
    renderShell("/");
    const main = screen.getByRole("main");
    expect(main.closest("[inert]")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(main.closest("[inert]")).not.toBeNull();
    expect(screen.getByTestId("app-shell-sidebar")).toHaveAttribute("inert");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(main.closest("[inert]")).toBeNull());
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();
  });

  it("names the tab after the page in the interface locale and keeps it after metadata rewrites", async () => {
    localStorage.setItem("rag-steplab.preferences.v3", JSON.stringify({ locale: "tr", showLearningHints: true, theme: "system" }));
    renderShell("/parse");

    await waitFor(() => expect(document.title).toBe("Ayrıştırma · RAG StepLab"));
    // Streamed route metadata (English) rewrites <title>; the localized name returns.
    document.title = "Parsing · RAG StepLab";
    await waitFor(() => expect(document.title).toBe("Ayrıştırma · RAG StepLab"));
  });

  it("keeps the English route title for English and leaves unknown routes alone", async () => {
    renderShell("/evaluation");
    await waitFor(() => expect(document.title).toBe("Evaluation · RAG StepLab"));
    cleanup();

    document.title = "404: This page could not be found.";
    renderShell("/missing");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.title).toBe("404: This page could not be found.");
  });
});
