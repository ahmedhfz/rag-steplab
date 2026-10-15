"use client";

import { TransitionText } from "@/components/ui/transitions";

import { useSyncExternalStore } from "react";

import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { safeNextPath } from "@/lib/auth-redirect";
import { type AppCopy, useCopy } from "@/lib/copy";

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

const subscribeToLocation = () => () => undefined;

function getAuthErrorCode() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("auth_error") ?? "";
}

function getServerAuthErrorCode() {
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

/** Google OAuth is the only sign-in method; `/auth/google` starts it on the server. */
export function LoginScreen() {
  const auth = useCopy().auth;
  const labels = auth.login;
  const authErrorCode = useSyncExternalStore(subscribeToLocation, getAuthErrorCode, getServerAuthErrorCode);
  const nextPath = useSyncExternalStore(subscribeToLocation, getNextPath, getServerNextPath);
  const googleHref = nextPath === "/" ? "/auth/google" : `/auth/google?${new URLSearchParams({ next: nextPath }).toString()}`;
  const status = linkErrorMessage(authErrorCode, auth.linkErrors);

  return (
    <AuthShell>
      <section aria-labelledby="login-title" className="w-full max-w-sm">
        <h1 className="text-display-xs font-semibold text-primary" id="login-title">{labels.title}</h1>
        {/* Small screens hide the hero, so its one-line pitch moves under the title there. */}
        <p className="mt-2 text-md text-tertiary md:hidden" data-testid="auth-intro">{labels.intro}</p>

        <Button asChild className="mt-8 w-full" size="lg" variant="secondary"><a aria-describedby="login-status" href={googleHref}><GoogleMark />{labels.google}</a></Button>
        <p aria-live="polite" className={status ? "mt-5 rounded-lg bg-secondary px-3.5 py-2.5 text-center text-sm text-secondary" : "sr-only"} id="login-status" role="status"><TransitionText>{status}</TransitionText></p>
      </section>
    </AuthShell>
  );
}
