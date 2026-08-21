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
  return `${name}:${code}:${status}`;
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
    console.error("oauth_callback_failed", { category: authErrorCategory(error) });
    return response;
  }
}
