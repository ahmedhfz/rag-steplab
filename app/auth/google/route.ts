import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

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
    response.headers.set("Location", data.url);
    return response;
  } catch {
    return response;
  }
}
