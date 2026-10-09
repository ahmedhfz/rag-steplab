import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowserClient: () => ({
    auth: {
      signInWithPassword: mocks.signInWithPassword,
      signUp: mocks.signUp,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
    },
  }),
  supabaseAuthErrorMessage: () => "İşlem tamamlanamadı. Lütfen tekrar deneyin.",
}));

import { LoginScreen } from "@/components/login-screen";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.signUp.mockResolvedValue({ data: { session: null }, error: null });
  mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
});

describe("LoginScreen Supabase auth flows", () => {
  it("signs in with email and password and activates the application route", async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.type(screen.getByLabelText("E-posta"), "user@example.com");
    await user.type(screen.getByLabelText("Şifre"), "password1234");
    await user.click(screen.getByRole("button", { name: "Giriş yap" }));

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "user@example.com", password: "password1234" });
    expect(mocks.replace).toHaveBeenCalledWith("/");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("returns to a same-origin deep link after sign-in and ignores hostile next values", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/login?next=%2Fevaluation%3Ftab%3Dresults");
    const view = render(<LoginScreen />);

    expect(screen.getByRole("link", { name: "Google ile devam et" })).toHaveAttribute("href", "/auth/google?next=%2Fevaluation%3Ftab%3Dresults");
    await user.type(screen.getByLabelText("E-posta"), "user@example.com");
    await user.type(screen.getByLabelText("Şifre"), "password1234");
    await user.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(mocks.replace).toHaveBeenCalledWith("/evaluation?tab=results");

    view.unmount();
    mocks.replace.mockClear();
    window.history.replaceState({}, "", "/login?next=%2F%2Fevil.example");
    render(<LoginScreen />);
    expect(screen.getByRole("link", { name: "Google ile devam et" })).toHaveAttribute("href", "/auth/google");
    await user.type(screen.getByLabelText("E-posta"), "user@example.com");
    await user.type(screen.getByLabelText("Şifre"), "password1234");
    await user.click(screen.getByRole("button", { name: "Giriş yap" }));
    expect(mocks.replace).toHaveBeenCalledWith("/");
  });

  it("starts signup with an email confirmation redirect", async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.click(screen.getByRole("button", { name: "Kayıt ol" }));
    await user.type(screen.getByLabelText("E-posta"), "new@example.com");
    await user.type(screen.getByLabelText("Şifre"), "password1234");
    await user.type(screen.getByLabelText("Şifre tekrarı"), "password1234");
    await user.click(screen.getByRole("button", { name: "Kayıt ol" }));

    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "password1234",
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    expect(screen.getByRole("status")).toHaveTextContent("e-posta adresinizi doğrulayın");
  });

  it("uses the recovery callback for forgot-password", async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    await user.click(screen.getByRole("button", { name: "Şifremi unuttum" }));
    await user.type(screen.getByLabelText("E-posta"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "Bağlantı gönder" }));

    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("user@example.com", {
      redirectTo: `${window.location.origin}/auth/confirm?next=/auth/reset-password`,
    });
    expect(screen.getByRole("status")).toHaveTextContent("Şifre yenileme bağlantısı");
  });

  it("starts Google OAuth through the server-side auth route", async () => {
    const user = userEvent.setup();
    render(<LoginScreen />);

    const googleLink = screen.getByRole("link", { name: "Google ile devam et" });
    await user.click(googleLink);

    expect(googleLink).toHaveAttribute("href", "/auth/google");
  });

  it("shows OAuth errors after hydration without changing the initial server markup", async () => {
    window.history.replaceState({}, "", "/login?auth_error=oauth_failed");
    render(<LoginScreen />);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Google ile giriş tamamlanamadı"));
  });
});
