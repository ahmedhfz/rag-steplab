import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { LoginScreen } from "@/components/login-screen";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("LoginScreen Google OAuth entry", () => {
  it("starts Google OAuth through the server-side auth route", () => {
    window.history.replaceState({}, "", "/login");
    render(<LoginScreen />);

    expect(screen.getByRole("link", { name: "Google ile devam et" })).toHaveAttribute("href", "/auth/google");
  });

  it("carries a same-origin deep link to the Google route and ignores hostile next values", () => {
    window.history.replaceState({}, "", "/login?next=%2Fevaluation%3Ftab%3Dresults");
    const view = render(<LoginScreen />);
    expect(screen.getByRole("link", { name: "Google ile devam et" })).toHaveAttribute("href", "/auth/google?next=%2Fevaluation%3Ftab%3Dresults");

    view.unmount();
    for (const hostile of ["%2F%2Fevil.example", "https%3A%2F%2Fevil.example%2F", "%2Flogin%3Fnext%3D%2Fplayground"]) {
      window.history.replaceState({}, "", `/login?next=${hostile}`);
      const hostileView = render(<LoginScreen />);
      expect(screen.getByRole("link", { name: "Google ile devam et" }), hostile).toHaveAttribute("href", "/auth/google");
      hostileView.unmount();
    }
  });

  it("shows OAuth errors after hydration and ties them to the Google action", async () => {
    window.history.replaceState({}, "", "/login?auth_error=oauth_failed");
    render(<LoginScreen />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Google ile giriş tamamlanamadı"));
    expect(screen.getByRole("link", { name: "Google ile devam et" })).toHaveAccessibleDescription(/Google ile giriş tamamlanamadı/);
  });

  it.each([
    // A prototype key used to resolve to Object.prototype and crash the render.
    "__proto__",
    // Codes of the removed email confirmation/recovery route no longer map to a message.
    "confirmation_invalid_or_expired",
    "recovery_invalid_or_expired",
  ])("ignores auth_error %s that no auth route handler sets", async (code) => {
    window.history.replaceState({}, "", `/login?auth_error=${code}`);
    render(<LoginScreen />);

    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
