import { NextResponse } from "next/server";

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

function callbackDiagnostics(request: Request, url: URL) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieNames = cookieHeader
    .split(";")
    .map((part) => part.split("=", 1)[0].trim())
    .filter(Boolean);
  const flowId = url.searchParams.get("sb_flow_id");

  return {
    codePresent: url.searchParams.has("code"),
    flowIdPresent: url.searchParams.has("sb_flow_id"),
    flowIdFormatValid: /^[A-Za-z0-9_-]{8,64}$/.test(flowId ?? ""),
    queryKeys: [...new Set(url.searchParams.keys())].sort(),
    cookieCount: cookieNames.length,
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
    response.headers.set("Location", new URL("/", request.url).toString());
    return response;
  } catch (error) {
    console.error("oauth_callback_failed", {
      category: authErrorCategory(error),
      diagnostics: callbackDiagnostics(request, url),
    });
    return response;
  }
}
