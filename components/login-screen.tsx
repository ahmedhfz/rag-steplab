"use client";

import { IconSwap, TransitionForm, TransitionText } from "@/components/ui/transitions";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { shakeValidation } from "@/lib/transitions";
import { AuthShell, MIN_PASSWORD_LENGTH } from "@/components/auth-shell";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePreferences } from "@/components/preferences-provider";
import { safeNextPath } from "@/lib/auth-redirect";
import { getSupabaseBrowserClient, supabaseAuthErrorMessage } from "@/lib/supabase/browser";
import { type AppCopy, type AppLocale, interpolate, useCopy } from "@/lib/copy";

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24">
      <path d="M21.35 12.23c0-.73-.06-1.43-.19-2.1H12v3.98h5.23a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.92-4.18 2.92-7.27Z" fill="#4285F4" />
      <path d="M12 21.6c2.63 0 4.83-.87 6.43-2.36l-3.14-2.45c-.87.58-1.98.92-3.29.92-2.53 0-4.68-1.71-5.45-4.01H3.3v2.53A9.71 9.71 0 0 0 12 21.6Z" fill="#34A853" />
      <path d="M6.55 13.7a5.84 5.84 0 0 1 0-3.4V7.77H3.3a9.71 9.71 0 0 0 0 8.46l3.25-2.53Z" fill="#FBBC05" />
      <path d="M12 6.29c1.43 0 2.72.49 3.73 1.45l2.8-2.8C16.82 3.36 14.62 2.4 12 2.4a9.71 9.71 0 0 0-8.7 5.37l3.25 2.53c.77-2.3 2.92-4.01 5.45-4.01Z" fill="#EA4335" />
    </svg>
  );
}

type Mode = "signin" | "signup" | "forgot";

const subscribeToAuthError = () => () => undefined;

function getAuthErrorMessage() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("auth_error") ?? "";
}

function getServerAuthErrorMessage() {
  return "";
}

/** Post-login destination; only a same-origin relative path is honored. */
function getNextPath() {
  if (typeof window === "undefined") return "/";
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

function getServerNextPath() {
  return "/";
}

/** Only codes the auth route handlers set map to a message; anything else stays silent. */
function linkErrorMessage(code: string, linkErrors: AppCopy["auth"]["linkErrors"]) {
  return Object.hasOwn(linkErrors, code) ? linkErrors[code as keyof typeof linkErrors] : "";
}

function friendlyAuthError(error: unknown, errors: AppCopy["auth"]["errors"], locale: AppLocale) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("invalid login credentials")) return errors.invalidCredentials;
  if (message.includes("user already registered") || message.includes("already been registered")) return errors.alreadyRegistered;
  if (message.includes("email not confirmed")) return errors.emailNotConfirmed;
  if (message.includes("password")) return errors.passwordRequirements;
  if (message.includes("rate limit") || message.includes("too many")) return errors.rateLimited;
  return supabaseAuthErrorMessage(error, locale);
}

export function LoginScreen() {
  const { preferences } = usePreferences();
  const auth = useCopy().auth;
  const labels = auth.login;
  const router = useRouter();
  const urlAuthErrorCode = useSyncExternalStore(subscribeToAuthError, getAuthErrorMessage, getServerAuthErrorMessage);
  const nextPath = useSyncExternalStore(subscribeToAuthError, getNextPath, getServerNextPath);
  const googleHref = nextPath === "/" ? "/auth/google" : `/auth/google?${new URLSearchParams({ next: nextPath }).toString()}`;
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
        setStatusMessage(auth.messages.resetLinkSent);
        return;
      }
      if (mode === "signup") {
        if (password.length < MIN_PASSWORD_LENGTH) {
          setStatusMessage(interpolate(auth.messages.passwordTooShort, { min: MIN_PASSWORD_LENGTH }));
          return;
        }
        if (password !== confirmation) {
          shakeValidation(document.getElementById("login-password-confirm"));
          setStatusMessage(auth.messages.passwordMismatch);
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          // The validated deep link survives email confirmation; /auth/confirm re-validates it.
          options: { emailRedirectTo: `${window.location.origin}/auth/confirm${nextPath === "/" ? "" : `?${new URLSearchParams({ next: nextPath }).toString()}`}` },
        });
        if (error) throw error;
        if (data.session) {
          router.replace(nextPath);
          router.refresh();
        } else setStatusMessage(auth.messages.accountCreated);
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace(nextPath);
      // Auth cookie değişikliğinin stale App Router cache'inde kalmasını engeller.
      router.refresh();
    } catch (error) {
      setStatusMessage(friendlyAuthError(error, auth.errors, preferences.locale));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "signup" ? labels.titleSignUp : mode === "forgot" ? labels.titleForgot : labels.titleSignIn;
  const subtitle = mode === "signin" ? labels.subtitleSignIn : mode === "signup" ? labels.subtitleSignUp : labels.subtitleForgot;
  const submitLabel = mode === "signup" ? labels.submitSignUp : mode === "forgot" ? labels.submitForgot : labels.submitSignIn;
  const urlStatusMessage = linkErrorMessage(urlAuthErrorCode, auth.linkErrors);
  const visibleStatus = statusMessage || urlStatusMessage;

  return (
    <AuthShell>
      <section aria-label={labels.form} className="w-full max-w-[360px]">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
        {/* The desktop hero carries this message; small screens hide the hero and show it here. */}
        {mode !== "forgot" ? <p className="mt-3 text-sm text-muted-foreground md:hidden" data-testid="auth-intro">{labels.intro}</p> : null}

        <TransitionForm aria-describedby="login-status" className="mt-7" onSubmit={submit}>
          <div className="space-y-2">
            <label className="flex items-center justify-between text-sm font-medium text-foreground" htmlFor="login-email">
              <span>{labels.email}</span>
            </label>
            <Input autoComplete="email" className="h-10" id="login-email" onChange={(event) => setEmail(event.target.value)} placeholder={mode === "signup" || mode === "forgot" ? labels.emailPlaceholderSignup : labels.emailPlaceholder} required type="email" value={email} />
          </div>

          {mode !== "forgot" ? <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-sm font-medium text-foreground"><label htmlFor="login-password">{labels.password}</label>{mode === "signin" ? <button className="font-medium text-brand hover:underline" onClick={() => setAuthMode("forgot")} type="button">{labels.forgot}</button> : null}</div>
            <div className="relative">
              <Input autoComplete={mode === "signup" ? "new-password" : "current-password"} className="h-10 pr-10" id="login-password" minLength={mode === "signup" ? MIN_PASSWORD_LENGTH : undefined} onChange={(event) => setPassword(event.target.value)} placeholder={labels.passwordPlaceholder} required type={showPassword ? "text" : "password"} value={password} />
              <button aria-label={showPassword ? labels.hidePassword : labels.showPassword} className="absolute right-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-subtle-foreground transition-colors hover:text-foreground" onClick={() => setShowPassword((current) => !current)} type="button"><IconSwap active={showPassword} first={<AppIcon name="eye" className="size-4" />} second={<AppIcon name="eyeOff" className="size-4" />} /></button>
            </div>
          </div> : null}

          {mode === "signup" ? <div className="mt-4 space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="login-password-confirm">{labels.confirm}</label>
            <Input autoComplete="new-password" className="h-10" id="login-password-confirm" minLength={MIN_PASSWORD_LENGTH} onChange={(event) => setConfirmation(event.target.value)} placeholder={labels.confirmPlaceholder} required type="password" value={confirmation} />
          </div> : null}

          <Button className="mt-6 w-full" size="lg" disabled={busy} type="submit"><TransitionText>{busy ? labels.wait : submitLabel}</TransitionText>{mode === "signin" && !busy ? <AppIcon name="arrowRight" className="size-4" /> : null}</Button>
        </TransitionForm>

        {mode === "signin" ? <>
          <div className="my-6 flex items-center gap-3 text-xs text-subtle-foreground"><span aria-hidden="true" className="h-px flex-1 bg-border" /><span>{labels.or}</span><span aria-hidden="true" className="h-px flex-1 bg-border" /></div>
          <Button asChild className="w-full" size="lg" variant="outline"><a href={googleHref}><GoogleMark />{labels.google}</a></Button>
        </> : null}

        {mode === "signup" ? <>
          <div className="my-6 flex items-center gap-3 text-xs text-subtle-foreground"><span aria-hidden="true" className="h-px flex-1 bg-border" /><span>{labels.or}</span><span aria-hidden="true" className="h-px flex-1 bg-border" /></div>
          <Button asChild className="w-full" size="lg" variant="outline"><a href={googleHref}><GoogleMark />{labels.google}</a></Button>
        </> : null}

        {mode === "forgot" ? <div className="mt-6 text-center"><button className="text-sm font-medium text-brand underline-offset-4 hover:underline" onClick={() => setAuthMode("signin")} type="button">{labels.back}</button></div> : null}
        <p aria-live="polite" className={visibleStatus ? "mt-4 min-h-5 text-center text-xs leading-5 text-muted-foreground" : "sr-only"} id="login-status" role="status"><TransitionText>{visibleStatus}</TransitionText></p>
        {mode === "signin" ? <div className="mt-6 text-center text-sm text-muted-foreground"><span>{labels.noAccount}</span>{" "}<button className="font-medium text-brand underline-offset-4 hover:underline" onClick={() => setAuthMode("signup")} type="button">{labels.submitSignUp}</button></div> : null}
        {mode === "signup" ? <div className="mt-6 text-center text-sm text-muted-foreground"><span>{labels.alreadyAccount}</span>{" "}<button className="font-medium text-brand underline-offset-4 hover:underline" onClick={() => setAuthMode("signin")} type="button">{labels.submitSignIn}</button></div> : null}
      </section>
    </AuthShell>
  );
}
