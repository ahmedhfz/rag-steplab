import { userAgent, type NextRequest } from "next/server";

import { loginPathWithNext, safeNextPath } from "@/lib/auth-redirect";
import { redirectWithSessionCookies, rewriteWithSessionCookies, updateSupabaseSession } from "@/lib/supabase/proxy";

const publicRoutes = new Set(["/login", "/auth/google", "/auth/callback", "/auth/confirm"]);
// Browser icons, robots.txt and the share image (Next metadata file routes) stay public: link-preview crawlers have no session.
const publicAssetRoutes = new Set(["/favicon.ico", "/robots.txt", "/opengraph-image", "/apple-icon"]);

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const { response, authenticated } = await updateSupabaseSession(request);
  if (pathname.startsWith("/_next/") || publicAssetRoutes.has(pathname)) return response;
  if (publicRoutes.has(pathname)) {
    return pathname === "/login" && authenticated
      ? redirectWithSessionCookies(response, request, safeNextPath(request.nextUrl.searchParams.get("next")))
      : response;
  }
  // The shared root is the canonical og:url. Crawlers get the sign-in page (same share metadata) with a 200 there:
  // redirecting them to a page whose og:url is this redirecting root is a canonical loop for link-preview bots.
  if (!authenticated && pathname === "/" && userAgent(request).isBot) return rewriteWithSessionCookies(response, request, "/login");
  if (!authenticated) return redirectWithSessionCookies(response, request, loginPathWithNext(`${pathname}${request.nextUrl.search}`));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots\\.txt$|opengraph-image$|apple-icon$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
