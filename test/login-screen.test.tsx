import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import { LoginScreen } from "@/components/login-screen";
import { PreferencesProvider } from "@/components/preferences-provider";

afterEach(() => cleanup());

describe("LoginScreen", () => {
  it("renders the reference login structure with the custom auth entry points", () => {
    render(<LoginScreen />);

    // A10: the visible title is the heading's only accessible name.
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Hesabınıza giriş yapın");
    expect(screen.getByLabelText("E-posta")).toHaveAttribute("placeholder", "ornek@firma.com");
    expect(screen.getByLabelText("Şifre")).toHaveAttribute("type", "password");
    expect(screen.getByRole("link", { name: "Google ile devam et" }))
      .toHaveAttribute("href", "/auth/google");
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
    // E2E helpers sign in through these exact English names.
    expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign in");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password", { exact: true })).toBeInTheDocument();
  });

  it("supports password visibility and maps missing local auth configuration safely", async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(screen.getByLabelText("E-posta"), "user@example.com");
    await user.type(screen.getByLabelText("Şifre"), "password1234");
    await user.click(screen.getByRole("button", { name: "Şifreyi göster" }));
    expect(screen.getByLabelText("Şifre")).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(screen.getByRole("status")).toHaveTextContent("Kimlik doğrulama yapılandırması eksik");
  });
});
