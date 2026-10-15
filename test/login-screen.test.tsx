import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import { LoginScreen } from "@/components/login-screen";
import { PreferencesProvider } from "@/components/preferences-provider";

afterEach(() => cleanup());

describe("LoginScreen", () => {
  it("offers Google as the only sign-in method", () => {
    const { container } = render(<LoginScreen />);

    // A10: the visible title is the heading's only accessible name.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveAccessibleName("Giriş yap");
    expect(screen.getByRole("region", { name: "Giriş yap" })).toContainElement(heading);
    expect(screen.getByRole("link", { name: "Google ile devam et" })).toHaveAttribute("href", "/auth/google");
    // No email/password sign-in, sign-up or reset entry points remain.
    expect(container.querySelector("form, input")).toBeNull();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/E-posta|Şifre|Kayıt ol/)).not.toBeInTheDocument();
    expect(screen.queryByText("RAG'inizin her adımını anlayın.")).not.toBeInTheDocument();
  });

  it("shows decorative pipeline art above the localized hero headline", () => {
    render(<LoginScreen />);

    const hero = screen.getByRole("region", { name: "PDF'den cevaba" });
    expect(hero).toBe(screen.getByTestId("auth-hero"));
    // The art is decorative: the headline and description carry the meaning.
    const art = within(hero).getByTestId("auth-hero-art");
    expect(art).toHaveAttribute("alt", "");
    expect(art).toHaveAttribute("aria-hidden", "true");
    expect(within(hero).queryByRole("img")).not.toBeInTheDocument();
    expect(hero.firstElementChild).toBe(art);
  });

  it("switches the hero and first-use explanation with the selected language", async () => {
    const user = userEvent.setup();
    render(<PreferencesProvider><LoginScreen /></PreferencesProvider>);
    await user.click(screen.getByRole("button", { name: "TR" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "PDF'den cevaba" })).toBeInTheDocument());
    expect(screen.getByTestId("auth-intro")).toHaveTextContent(/^PDF'den cevaba/);

    await user.click(screen.getByRole("button", { name: "EN" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "From PDF to answer" })).toBeInTheDocument());
    expect(screen.getByTestId("auth-intro")).toHaveTextContent(/^From PDF to answer/);
    // E2E and visual specs find the screen through these exact English names.
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign in");
    expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", "/auth/google");
  });
});
