import { NextResponse } from "next/server";

import { AUTH_NEXT_COOKIE, AUTH_NEXT_COOKIE_MAX_AGE_SECONDS, safeNextPath } from "@/lib/auth-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function valueFingerprint(value: string | undefined) {
  if (!value) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

function decodeStorageValue(value: string | undefined) {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    const json = decoded.startsWith("base64-")
      ? Buffer.from(decoded.slice("base64-".length), "base64url").toString("utf8")
      : decoded;
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const response = NextResponse.redirect(new URL("/login?auth_error=oauth_failed", requestUrl));

  try {
    const supabase = await createSupabaseServerClient(response);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${requestUrl.origin}/auth/callback`,
      },
    });

    if (error || !data.url) throw error ?? new Error("oauth_url_missing");
    const pkceCookie = response.cookies
      .getAll()
      .find(({ name }) => /-auth-token-flow-[A-Za-z0-9_-]{8,64}-code-verifier(?:\.\d+)?$/.test(name));
    console.info("oauth_started", {
      pkceCookiePresent: Boolean(pkceCookie),
      pkceCookieFingerprint: await valueFingerprint(pkceCookie?.value),
      pkceVerifierFingerprint: await valueFingerprint(decodeStorageValue(pkceCookie?.value) ?? undefined),
      pkceCookieLength: pkceCookie?.value.length ?? 0,
    });
    response.headers.set("Location", data.url);
    // The OAuth redirect allow-list stays a fixed callback URL; the post-login
    // destination travels in a short-lived, path-scoped cookie instead.
    const next = safeNextPath(requestUrl.searchParams.get("next"));
    if (next !== "/") {
      response.cookies.set(AUTH_NEXT_COOKIE, next, {
        httpOnly: true,
        sameSite: "lax",
        secure: requestUrl.protocol === "https:",
        path: "/auth",
        maxAge: AUTH_NEXT_COOKIE_MAX_AGE_SECONDS,
      });
    }
    return response;
  } catch {
    return response;
  }
}
