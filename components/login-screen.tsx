"use client";

import { useRouter } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePreferences } from "@/components/preferences-provider";
import { getSupabaseBrowserClient, supabaseAuthErrorMessage } from "@/lib/supabase/browser";
import type { AppLocale } from "@/lib/copy";

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="size-[17px]" viewBox="0 0 24 24">
      <path d="M21.35 12.23c0-.73-.06-1.43-.19-2.1H12v3.98h5.23a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.92-4.18 2.92-7.27Z" fill="#4285F4" />
      <path d="M12 21.6c2.63 0 4.83-.87 6.43-2.36l-3.14-2.45c-.87.58-1.98.92-3.29.92-2.53 0-4.68-1.71-5.45-4.01H3.3v2.53A9.71 9.71 0 0 0 12 21.6Z" fill="#34A853" />
      <path d="M6.55 13.7a5.84 5.84 0 0 1 0-3.4V7.77H3.3a9.71 9.71 0 0 0 0 8.46l3.25-2.53Z" fill="#FBBC05" />
      <path d="M12 6.29c1.43 0 2.72.49 3.73 1.45l2.8-2.8C16.82 3.36 14.62 2.4 12 2.4a9.71 9.71 0 0 0-8.7 5.37l3.25 2.53c.77-2.3 2.92-4.01 5.45-4.01Z" fill="#EA4335" />
    </svg>
  );
}

type Mode = "signin" | "signup" | "forgot";

const AUTH_ERROR_MESSAGES: Record<AppLocale, Record<string, string>> = {
  tr: {
    confirmation_invalid_or_expired: "Doğrulama bağlantısı geçersiz veya süresi dolmuş.",
    recovery_invalid_or_expired: "Şifre yenileme bağlantısı geçersiz veya süresi dolmuş.",
    oauth_failed: "Google ile giriş tamamlanamadı. Lütfen tekrar deneyin.",
  },
  en: {
    confirmation_invalid_or_expired: "The confirmation link is invalid or expired.",
    recovery_invalid_or_expired: "The password reset link is invalid or expired.",
    oauth_failed: "Google sign-in could not be completed. Please try again.",
  },
};

const subscribeToAuthError = () => () => undefined;

function getAuthErrorMessage() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("auth_error") ?? "";
}

function getServerAuthErrorMessage() {
  return "";
}

function friendlyAuthError(error: unknown, locale: AppLocale) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const tr = locale === "tr";
  if (message.includes("invalid login credentials")) return tr ? "E-posta veya şifre hatalı." : "The email or password is incorrect.";
  if (message.includes("user already registered") || message.includes("already been registered")) return tr ? "Bu e-posta ile kayıtlı bir hesap zaten var." : "An account with this email already exists.";
  if (message.includes("email not confirmed")) return tr ? "Devam etmek için e-posta adresinizi doğrulayın." : "Confirm your email address before continuing.";
  if (message.includes("password")) return tr ? "Şifre gereksinimleri karşılanmıyor." : "The password does not meet the requirements.";
  if (message.includes("rate limit") || message.includes("too many")) return tr ? "Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin." : "Too many attempts. Please try again shortly.";
  return supabaseAuthErrorMessage(error);
}

export function LoginScreen() {
  const { preferences } = usePreferences();
  const router = useRouter();
  const urlAuthErrorCode = useSyncExternalStore(subscribeToAuthError, getAuthErrorMessage, getServerAuthErrorMessage);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setAuthMode(nextMode: Mode) {
    setMode(nextMode);
    setStatusMessage("");
    setPassword("");
    setConfirmation("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatusMessage("");
    try {
        const supabase = getSupabaseBrowserClient();
        if (mode === "forgot") {
          const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/auth/confirm?next=/auth/reset-password`,
          });
        if (error) throw error;
        setStatusMessage(preferences.locale === "tr" ? "Şifre yenileme bağlantısı e-posta adresinize gönderildi." : "A password reset link was sent to your email.");
        return;
      }
      if (mode === "signup") {
        if (password.length < 10) {
          setStatusMessage(preferences.locale === "tr" ? "Şifreniz en az 10 karakter olmalı." : "Your password must be at least 10 characters.");
          return;
        }
        if (password !== confirmation) {
          setStatusMessage(preferences.locale === "tr" ? "Şifreler eşleşmiyor." : "The passwords do not match.");
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
        });
        if (error) throw error;
        if (data.session) {
          router.replace("/");
          router.refresh();
        }
        else setStatusMessage(preferences.locale === "tr" ? "Kayıt tamamlandı. Devam etmek için e-posta adresinizi doğrulayın." : "Account created. Confirm your email address before continuing.");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/");
      // Auth cookie değişikliğinin stale App Router cache'inde kalmasını engeller.
      router.refresh();
    } catch (error) {
      setStatusMessage(friendlyAuthError(error, preferences.locale));
    } finally {
      setBusy(false);
    }
  }

  const labels = preferences.locale === "tr" ? {
    titleSignIn: "Hesabınıza giriş yapın", titleSignUp: "Hesap oluşturun", titleForgot: "Şifrenizi yenileyin", submitSignIn: "Giriş yap", submitSignUp: "Kayıt ol", submitForgot: "Bağlantı gönder", wait: "Bekleyin…", email: "E-posta", emailPlaceholder: "ornek@firma.com", password: "Şifre", showPassword: "Şifreyi göster", hidePassword: "Şifreyi gizle", confirm: "Şifre tekrarı", google: "Google ile devam et", forgot: "Şifremi unuttum", back: "Giriş ekranına dön", noAccount: "Hesabın yok mu?", home: "RAG StepLab ana sayfa", form: "Giriş formu", footer: "RAG öğrenme laboratuvarı", backend: "RAG öğrenme pipeline'ı", or: "veya", language: "Dil",
  } : {
    titleSignIn: "Sign in to your account", titleSignUp: "Create an account", titleForgot: "Reset your password", submitSignIn: "Sign in", submitSignUp: "Sign up", submitForgot: "Send reset link", wait: "Please wait…", email: "Email", emailPlaceholder: "name@example.com", password: "Password", showPassword: "Show password", hidePassword: "Hide password", confirm: "Confirm password", google: "Continue with Google", forgot: "Forgot password?", back: "Back to sign in", noAccount: "Don't have an account?", home: "RAG StepLab home", form: "Sign-in form", footer: "RAG learning laboratory", backend: "RAG learning pipeline", or: "or", language: "Language",
  };
  const title = mode === "signup" ? labels.titleSignUp : mode === "forgot" ? labels.titleForgot : labels.titleSignIn;
  const submitLabel = mode === "signup" ? labels.submitSignUp : mode === "forgot" ? labels.submitForgot : labels.submitSignIn;
  const urlStatusMessage = AUTH_ERROR_MESSAGES[preferences.locale][urlAuthErrorCode] ?? "";

  return (
    <AuthShell>
      <section aria-label={labels.form} className="w-full max-w-[430px] border border-[#e7e2e4] bg-white p-6 shadow-[0_12px_35px_rgba(23,20,22,0.04)] sm:p-9">
        <div className="border-b border-[#e7e2e4] pb-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.13em] text-[#711f3a]">RAG StepLab</p>
          <h1 className="mt-3 text-[27px] font-semibold tracking-[-0.045em] text-[#171416]">{title}</h1>
          <p className="mt-2 text-sm leading-5 text-[#6e676a]">{mode === "signin" ? labels.backend : mode === "signup" ? labels.footer : labels.backend}</p>
        </div>
        <form aria-describedby="login-status" className="mt-6 space-y-4" onSubmit={submit}>
          <div className="space-y-2"><label className="text-xs font-medium text-[#171416]" htmlFor="login-email">{labels.email}</label><div className="relative"><Mail aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#969093]" /><Input autoComplete="email" className="h-11 border-[#d8d2d5] bg-white pl-10 pr-3 text-sm shadow-none placeholder:text-[#969093] focus-visible:border-[#711f3a] focus-visible:ring-[#711f3a]/15" id="login-email" onChange={(event) => setEmail(event.target.value)} placeholder={labels.emailPlaceholder} required type="email" value={email} /></div></div>
          {mode !== "forgot" && <div className="space-y-2"><label className="text-xs font-medium text-[#171416]" htmlFor="login-password">{labels.password}</label><div className="relative"><LockKeyhole aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#969093]" /><Input autoComplete={mode === "signup" ? "new-password" : "current-password"} className="h-11 border-[#d8d2d5] bg-white pl-10 pr-10 text-sm shadow-none placeholder:text-[#969093] focus-visible:border-[#711f3a] focus-visible:ring-[#711f3a]/15" id="login-password" minLength={mode === "signup" ? 10 : undefined} onChange={(event) => setPassword(event.target.value)} placeholder={labels.password} required type={showPassword ? "text" : "password"} value={password} /><button aria-label={showPassword ? labels.hidePassword : labels.showPassword} className="absolute right-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-[#969093] outline-none transition-colors hover:text-[#501329] focus-visible:ring-2 focus-visible:ring-[#711f3a]/25" onClick={() => setShowPassword((current) => !current)} type="button">{showPassword ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}</button></div></div>}
          {mode === "signup" && <div className="space-y-2"><label className="text-xs font-medium text-[#171416]" htmlFor="login-password-confirm">{labels.confirm}</label><Input autoComplete="new-password" className="h-11 border-[#d8d2d5] bg-white text-sm shadow-none placeholder:text-[#969093] focus-visible:border-[#711f3a] focus-visible:ring-[#711f3a]/15" id="login-password-confirm" minLength={10} onChange={(event) => setConfirmation(event.target.value)} placeholder={labels.confirm} required type="password" value={confirmation} /></div>}
          <Button className="h-11 w-full bg-[#171416] text-sm font-semibold text-white hover:bg-[#30292c]" disabled={busy} type="submit">{busy ? labels.wait : submitLabel}</Button>
        </form>
        {mode === "signin" && <><div className="my-6 flex items-center gap-3 text-[11px] text-[#969093]"><span aria-hidden="true" className="h-px flex-1 bg-[#e7e2e4]" /><span>{labels.or}</span><span aria-hidden="true" className="h-px flex-1 bg-[#e7e2e4]" /></div><Button asChild className="h-11 w-full border-[#d8d2d5] bg-white text-sm font-medium text-[#171416] shadow-none hover:bg-[#fbf4f6]" variant="outline"><a href="/auth/google"><GoogleMark />{labels.google}</a></Button><div className="mt-5 text-center"><button className="text-sm font-medium text-[#711f3a] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25" onClick={() => setAuthMode("forgot")} type="button">{labels.forgot}</button></div></>}
        {mode !== "signin" && <div className="mt-5 text-center"><button className="text-sm font-medium text-[#711f3a] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25" onClick={() => setAuthMode("signin")} type="button">{labels.back}</button></div>}
        <p aria-live="polite" className="mt-4 min-h-5 text-center text-xs leading-5 text-[#6e676a]" id="login-status" role="status">{statusMessage ?? urlStatusMessage}</p>
        {mode === "signin" ? <div className="mt-6 border-t border-[#e7e2e4] pt-6 text-center text-sm text-[#6e676a]"><span>{labels.noAccount}</span>{" "}<button className="font-medium text-[#711f3a] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25" onClick={() => setAuthMode("signup")} type="button">{labels.submitSignUp}</button></div> : null}
      </section>
    </AuthShell>
  );
}
