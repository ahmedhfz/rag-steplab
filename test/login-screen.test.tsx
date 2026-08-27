import { cleanup, render, screen } from "@testing-library/react";
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

afterEach(() => cleanup());

describe("LoginScreen", () => {
  it("renders the reference login structure with the custom auth entry points", () => {
    render(<LoginScreen />);

    expect(screen.getByRole("heading", { name: /giriş yapın|sign in to your account/i })).toBeVisible();
    expect(screen.getByLabelText("E-posta")).toHaveAttribute("placeholder", "ornek@firma.com");
    expect(screen.getByLabelText("Şifre")).toHaveAttribute("type", "password");
    expect(screen.getByRole("link", { name: "Google ile devam et" }))
      .toHaveAttribute("href", "/auth/google");
    expect(screen.getByTestId("auth-hero-image")).toHaveAttribute("alt", expect.stringContaining("RAG"));
    expect(screen.queryByText("RAG'inizin her adımını anlayın.")).not.toBeInTheDocument();
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
