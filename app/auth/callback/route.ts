import { NextResponse } from "next/server";

import { AUTH_NEXT_COOKIE, readCookie, safeNextPath } from "@/lib/auth-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function authErrorCategory(error: unknown) {
  if (!error || typeof error !== "object") return "unknown";

  const name = "name" in error && typeof error.name === "string" ? error.name : "unknown";
  const code = "code" in error && typeof error.code === "string" ? error.code : "unknown";
  const status =
    "status" in error && (typeof error.status === "number" || typeof error.status === "string")
      ? String(error.status)
      : "unknown";
  const message = "message" in error && typeof error.message === "string" ? error.message.toLowerCase() : "";
  const reason = message.includes("code challenge")
    ? "code_challenge"
    : message.includes("code verifier") || message.includes("verifier")
      ? "code_verifier"
      : message.includes("invalid grant")
        ? "invalid_grant"
        : message.includes("authorization code") || message.includes("auth code")
          ? "auth_code"
          : message.includes("expired") || message.includes("expire")
            ? "expired"
            : message.includes("redirect")
              ? "redirect"
              : "unknown";
  return `${name}:${code}:${status}:${reason}`;
}

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

async function callbackDiagnostics(request: Request, url: URL) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookies = cookieHeader
    .split(";")
    .map((part) => {
      const separator = part.indexOf("=");
      return separator > 0
        ? { name: part.slice(0, separator).trim(), value: part.slice(separator + 1).trim() }
        : null;
    })
    .filter((cookie): cookie is { name: string; value: string } => Boolean(cookie?.name));
  const cookieNames = cookies.map((cookie) => cookie.name);
  const flowId = url.searchParams.get("sb_flow_id");
  const flowCookie =
    (flowId
      ? cookies.find((cookie) => cookie.name.includes(`-auth-token-flow-${flowId}-code-verifier`))
      : undefined) ??
    cookies.find((cookie) => /-auth-token-flow-[A-Za-z0-9_-]{8,64}-code-verifier(?:\.\d+)?$/.test(cookie.name));

  return {
    codePresent: url.searchParams.has("code"),
    flowIdPresent: url.searchParams.has("sb_flow_id"),
    flowIdFormatValid: /^[A-Za-z0-9_-]{8,64}$/.test(flowId ?? ""),
    queryKeys: [...new Set(url.searchParams.keys())].sort(),
    cookieCount: cookieNames.length,
    pkceCookieFingerprint: await valueFingerprint(flowCookie?.value),
    pkceVerifierFingerprint: await valueFingerprint(decodeStorageValue(flowCookie?.value) ?? undefined),
    pkceCookieLength: flowCookie?.value.length ?? 0,
    pkceCookiePresence: {
      flowSlot: cookieNames.some((name) => /-auth-token-flow-[A-Za-z0-9_-]{8,64}-code-verifier(?:\.\d+)?$/.test(name)),
      flowSlotMatchesCallback: flowId
        ? cookieNames.some((name) => name.includes(`-auth-token-flow-${flowId}-code-verifier`))
        : false,
      flowIndex: cookieNames.some((name) => /-auth-token-flows-code-verifier(?:\.\d+)?$/.test(name)),
      legacyVerifier: cookieNames.some((name) => /-auth-token-code-verifier(?:\.\d+)?$/.test(name)),
    },
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const flowId = url.searchParams.get("sb_flow_id");
  if (!code) return NextResponse.redirect(new URL("/login?auth_error=oauth_failed", request.url));
  const response = NextResponse.redirect(new URL("/login?auth_error=oauth_failed", request.url));

  try {
    const supabase = await createSupabaseServerClient(response);
    const { error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
    if (error) throw error;
    const next = safeNextPath(readCookie(request.headers.get("cookie"), AUTH_NEXT_COOKIE));
    response.headers.set("Location", new URL(next, request.url).toString());
    response.cookies.set(AUTH_NEXT_COOKIE, "", { path: "/auth", maxAge: 0 });
    return response;
  } catch (error) {
    console.error("oauth_callback_failed", {
      category: authErrorCategory(error),
      diagnostics: await callbackDiagnostics(request, url),
    });
    return response;
  }
}
