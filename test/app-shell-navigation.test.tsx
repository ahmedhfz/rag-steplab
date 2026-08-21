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
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
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
import { PreferencesProvider } from "@/components/preferences-provider";

function renderShell(pathname: string) {
  navigationState.pathname = pathname;
  return render(
    <PreferencesProvider>
      <AppShell><p>Page content</p></AppShell>
    </PreferencesProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

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
  it("keeps the page content visible when the pathname changes in the same shell", () => {
    navigationState.pathname = "/documents";
    const { rerender } = render(
      <PreferencesProvider>
        <AppShell><p>Document overview</p></AppShell>
      </PreferencesProvider>,
    );

    navigationState.pathname = "/documents/parsed";
    rerender(
      <PreferencesProvider>
        <AppShell><p>Parsed content</p></AppShell>
      </PreferencesProvider>,
    );

    expect(screen.getByRole("main")).toHaveTextContent("Parsed content");
    expect(screen.getByText("Parsed content")).toBeVisible();
    expect(screen.getByRole("main").firstElementChild).not.toHaveAttribute("style");
  });

  it.each([
    ["/documents/parsed", "Documents", "/documents"],
    ["/documents/chunks", "Chunks", "/documents/chunks"],
    ["/retrieval", "Retrieval", "/retrieval"],
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
    expect(screen.getByText("AH")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Ahmed Hafızoğlu — Account menu" }));
    const menu = screen.getByRole("dialog", { name: "Account menu" });

    await waitFor(() => expect(within(menu).getByRole("button", { name: "Guides" })).toBeVisible());
    expect(within(menu).getByRole("button", { name: "Help" })).toBeVisible();
    expect(within(menu).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(within(menu).getByRole("button", { name: "Sign out" })).toBeVisible();

    await user.click(within(menu).getByRole("button", { name: "Guides" }));
    expect(within(menu).getByText("Learn the RAG flow")).toBeVisible();
  });
});
