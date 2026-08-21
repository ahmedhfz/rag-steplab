import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const allowedTypes = new Set(["email", "recovery"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const code = url.searchParams.get("code");
  const flowId = url.searchParams.get("sb_flow_id");
  const next = url.searchParams.get("next");
  const recoveryFlow = type === "recovery" || next === "/auth/reset-password";

  if ((!tokenHash && !code) || (tokenHash && (!type || !allowedTypes.has(type)))) {
    return NextResponse.redirect(new URL("/login?auth_error=confirmation_invalid_or_expired", request.url));
  }

  const response = NextResponse.redirect(new URL("/login?auth_error=confirmation_invalid_or_expired", request.url));

  try {
    const supabase = await createSupabaseServerClient(response);
    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as "email" | "recovery",
        })
      : await supabase.auth.exchangeCodeForSession(code as string, flowId ? { flowId } : undefined);
    if (error) throw error;
    response.headers.set("Location", new URL(recoveryFlow ? "/auth/reset-password" : "/", request.url).toString());
    return response;
  } catch {
    const errorCode = recoveryFlow ? "recovery_invalid_or_expired" : "confirmation_invalid_or_expired";
    response.headers.set("Location", new URL(`/login?auth_error=${errorCode}`, request.url).toString());
    return response;
  }
}
