import type { NextRequest } from "next/server";

import { redirectWithSessionCookies, updateSupabaseSession } from "@/lib/supabase/proxy";

const publicRoutes = new Set(["/login", "/auth/google", "/auth/callback", "/auth/confirm"]);

export async function proxy(request: NextRequest) {
  const { response, authenticated } = await updateSupabaseSession(request);
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") return response;
  if (publicRoutes.has(pathname)) {
    return pathname === "/login" && authenticated
      ? redirectWithSessionCookies(response, request, "/")
      : response;
  }
  if (!authenticated) return redirectWithSessionCookies(response, request, "/login");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|__visual__/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
