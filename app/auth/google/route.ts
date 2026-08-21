import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${requestUrl.origin}/auth/callback`,
      },
    });

    if (error || !data.url) throw error ?? new Error("oauth_url_missing");
    return NextResponse.redirect(data.url);
  } catch {
    return NextResponse.redirect(new URL("/login?auth_error=oauth_failed", requestUrl));
  }
}
