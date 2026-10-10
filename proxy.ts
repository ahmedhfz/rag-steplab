import type { NextRequest } from "next/server";

import { loginPathWithNext, safeNextPath } from "@/lib/auth-redirect";
import { redirectWithSessionCookies, updateSupabaseSession } from "@/lib/supabase/proxy";

const publicRoutes = new Set(["/login", "/auth/google", "/auth/callback", "/auth/confirm"]);

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const { response, authenticated } = await updateSupabaseSession(request);
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico") return response;
  if (publicRoutes.has(pathname)) {
    return pathname === "/login" && authenticated
      ? redirectWithSessionCookies(response, request, safeNextPath(request.nextUrl.searchParams.get("next")))
      : response;
  }
  if (!authenticated) return redirectWithSessionCookies(response, request, loginPathWithNext(`${pathname}${request.nextUrl.search}`));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
