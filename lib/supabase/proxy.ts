import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { response, authenticated: false };

  const supabase = createServerClient(url, key, {
    auth: {
      flowType: "pkce",
      experimental: { appendPkceFlowIdToRedirects: true },
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  return { response, authenticated: Boolean(data?.claims) };
}

function withSessionCookies(target: NextResponse, response: NextResponse) {
  response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

export function redirectWithSessionCookies(response: NextResponse, request: NextRequest, path: string) {
  return withSessionCookies(NextResponse.redirect(new URL(path, request.url)), response);
}

export function rewriteWithSessionCookies(response: NextResponse, request: NextRequest, path: string) {
  return withSessionCookies(NextResponse.rewrite(new URL(path, request.url)), response);
}
