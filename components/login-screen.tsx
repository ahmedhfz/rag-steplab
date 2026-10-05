"use client";

import { IconSwap, TransitionForm, TransitionText } from "@/components/ui/transitions";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { shakeValidation } from "@/lib/transitions";
import { AuthShell } from "@/components/auth-shell";
import { AppIcon } from "@/components/ui/app-icon";
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
          shakeValidation(document.getElementById("login-password-confirm"));
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
        } else setStatusMessage(preferences.locale === "tr" ? "Kayıt tamamlandı. Devam etmek için e-posta adresinizi doğrulayın." : "Account created. Confirm your email address before continuing.");
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

  const labels = preferences.locale === "tr"
    ? {
        titleSignIn: "Hesabınıza giriş yapın", titleSignInAccessible: "Hesabınıza giriş yapın", titleSignUp: "Hesap oluşturun", titleForgot: "Şifrenizi yenileyin", subtitleSignIn: "RAG StepLab çalışma alanınıza devam edin.", subtitleSignUp: "RAG'inizi oluşturmaya ve anlamaya başlayın.", subtitleForgot: "Yeni bir şifre belirlemek için size güvenli bir bağlantı göndereceğiz.", submitSignIn: "Giriş yap", submitSignUp: "Kayıt ol", submitForgot: "Bağlantı gönder", wait: "Bekleyin…", email: "E-posta", emailPlaceholder: "ornek@firma.com", emailPlaceholderSignup: "siz@firma.com", password: "Şifre", passwordPlaceholder: "••••••••", showPassword: "Şifreyi göster", hidePassword: "Şifreyi gizle", confirm: "Şifre tekrarı", confirmPlaceholder: "Şifrenizi yeniden girin", google: "Google ile devam et", forgot: "Şifremi unuttum", back: "Giriş ekranına dön", noAccount: "Hesabın yok mu?", alreadyAccount: "Zaten hesabınız var mı?", home: "RAG StepLab ana sayfa", form: "Giriş formu", or: "veya", language: "Dil",
      }
    : {
        titleSignIn: "Sign in", titleSignInAccessible: "Sign in to your account", titleSignUp: "Create account", titleForgot: "Reset your password", subtitleSignIn: "Continue to your RAG StepLab workspace.", subtitleSignUp: "Start building and understanding your RAG.", subtitleForgot: "We'll email you a secure link to set a new password.", submitSignIn: "Sign in", submitSignUp: "Create account", submitForgot: "Send reset link", wait: "Please wait…", email: "Email", emailPlaceholder: "ayse@steplab.dev", emailPlaceholderSignup: "you@company.com", password: "Password", passwordPlaceholder: "••••••••", showPassword: "Show password", hidePassword: "Hide password", confirm: "Confirm password", confirmPlaceholder: "Re-enter password", google: "Continue with Google", forgot: "Forgot password?", back: "Back to sign in", noAccount: "Don't have an account?", alreadyAccount: "Already have an account?", home: "RAG StepLab home", form: "Sign-in form", or: "or", language: "Language",
      };
  const title = mode === "signup" ? labels.titleSignUp : mode === "forgot" ? labels.titleForgot : labels.titleSignIn;
  const titleAccessible = mode === "signin" ? labels.titleSignInAccessible : title;
  const subtitle = mode === "signin" ? labels.subtitleSignIn : mode === "signup" ? labels.subtitleSignUp : labels.subtitleForgot;
  const submitLabel = mode === "signup" ? labels.submitSignUp : mode === "forgot" ? labels.submitForgot : labels.submitSignIn;
  const urlStatusMessage = AUTH_ERROR_MESSAGES[preferences.locale][urlAuthErrorCode] ?? "";
  const visibleStatus = statusMessage || urlStatusMessage;

  return (
    <AuthShell>
      <section aria-label={labels.form} className="w-full max-w-[360px]">
        <h1 className="text-[24px] font-semibold leading-[29px] tracking-[-0.48px] text-foreground">{title}<span className="sr-only">{titleAccessible}</span></h1>
        <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{subtitle}</p>

        <TransitionForm aria-describedby="login-status" className="mt-7" onSubmit={submit}>
          <div className="space-y-2">
            <label className="flex items-center justify-between text-[13px] font-medium leading-[19px] text-foreground" htmlFor="login-email">
              <span>{labels.email}</span>
            </label>
            <Input autoComplete="email" className="h-[44px] rounded-[10px] border-[1.5px] border-input bg-card px-3 text-[13px] shadow-none placeholder:text-subtle-foreground focus-visible:border-brand focus-visible:ring-ring/15" id="login-email" onChange={(event) => setEmail(event.target.value)} placeholder={mode === "signup" || mode === "forgot" ? labels.emailPlaceholderSignup : labels.emailPlaceholder} required type="email" value={email} />
          </div>

          {mode !== "forgot" ? <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-[13px] font-medium leading-[19px] text-foreground"><label htmlFor="login-password">{labels.password}</label>{mode === "signin" ? <button className="font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/25" onClick={() => setAuthMode("forgot")} type="button">{labels.forgot}</button> : null}</div>
            <div className="relative">
              <Input autoComplete={mode === "signup" ? "new-password" : "current-password"} className="h-[44px] rounded-[10px] border-[1.5px] border-input bg-card px-3 pr-10 text-[13px] shadow-none placeholder:text-subtle-foreground focus-visible:border-brand focus-visible:ring-ring/15" id="login-password" minLength={mode === "signup" ? 10 : undefined} onChange={(event) => setPassword(event.target.value)} placeholder={labels.passwordPlaceholder} required type={showPassword ? "text" : "password"} value={password} />
              <button aria-label={showPassword ? labels.hidePassword : labels.showPassword} className="absolute right-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-subtle-foreground outline-none transition-colors hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/25" onClick={() => setShowPassword((current) => !current)} type="button"><IconSwap active={showPassword} first={<AppIcon name="eye" className="size-4" />} second={<AppIcon name="eyeOff" className="size-4" />} /></button>
            </div>
          </div> : null}

          {mode === "signup" ? <div className="mt-4 space-y-2">
            <label className="text-[13px] font-medium leading-[19px] text-foreground" htmlFor="login-password-confirm">{labels.confirm}</label>
            <Input autoComplete="new-password" className="h-[44px] rounded-[10px] border-[1.5px] border-input bg-card px-3 text-[13px] shadow-none placeholder:text-subtle-foreground focus-visible:border-brand focus-visible:ring-ring/15" id="login-password-confirm" minLength={10} onChange={(event) => setConfirmation(event.target.value)} placeholder={labels.confirmPlaceholder} required type="password" value={confirmation} />
          </div> : null}

          <Button className="mt-6 h-[43px] w-full rounded-[10px] bg-foreground text-[13px] font-medium text-primary-foreground hover:bg-strong-hover" disabled={busy} type="submit"><TransitionText>{busy ? labels.wait : submitLabel}</TransitionText>{mode === "signin" && !busy ? <AppIcon name="arrowRight" className="size-4" /> : null}</Button>
        </TransitionForm>

        {mode === "signin" ? <>
          <div className="my-6 flex items-center gap-3 text-[11px] text-subtle-foreground"><span aria-hidden="true" className="h-px flex-1 bg-border" /><span>{labels.or}</span><span aria-hidden="true" className="h-px flex-1 bg-border" /></div>
          <Button asChild className="h-[42px] w-full rounded-[10px] border-[1.5px] border-input bg-card text-[13px] font-medium text-foreground shadow-none hover:bg-accent" variant="outline"><a href="/auth/google"><GoogleMark />{labels.google}</a></Button>
        </> : null}

        {mode === "signup" ? <>
          <div className="my-6 flex items-center gap-3 text-[11px] text-subtle-foreground"><span aria-hidden="true" className="h-px flex-1 bg-border" /><span>{labels.or}</span><span aria-hidden="true" className="h-px flex-1 bg-border" /></div>
          <Button asChild className="h-[42px] w-full rounded-[10px] border-[1.5px] border-input bg-card text-[13px] font-medium text-foreground shadow-none hover:bg-accent" variant="outline"><a href="/auth/google"><GoogleMark />{labels.google}</a></Button>
        </> : null}

        {mode === "forgot" ? <div className="mt-6 text-center"><button className="text-[13px] font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25" onClick={() => setAuthMode("signin")} type="button">{labels.back}</button></div> : null}
        <p aria-live="polite" className={visibleStatus ? "mt-4 min-h-5 text-center text-xs leading-5 text-muted-foreground" : "sr-only"} id="login-status" role="status"><TransitionText>{visibleStatus}</TransitionText></p>
        {mode === "signin" ? <div className="mt-6 text-center text-[13px] text-muted-foreground"><span>{labels.noAccount}</span>{" "}<button className="font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25" onClick={() => setAuthMode("signup")} type="button">{labels.submitSignUp}</button></div> : null}
        {mode === "signup" ? <div className="mt-6 text-center text-[13px] text-muted-foreground"><span>{labels.alreadyAccount}</span>{" "}<button className="font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25" onClick={() => setAuthMode("signin")} type="button">{labels.submitSignIn}</button></div> : null}
      </section>
    </AuthShell>
  );
}
