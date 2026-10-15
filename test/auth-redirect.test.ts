// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ authenticated: false }));
const oauth = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/proxy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/proxy")>();
  return {
    ...actual,
    updateSupabaseSession: async (request: NextRequest) => ({ response: NextResponse.next({ request }), authenticated: session.authenticated }),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: oauth }),
}));

import { GET as googleGet } from "@/app/auth/google/route";
import { GET as callbackGet } from "@/app/auth/callback/route";
import { AUTH_NEXT_COOKIE, safeNextPath } from "@/lib/auth-redirect";
import { proxy } from "@/proxy";

afterEach(() => {
  session.authenticated = false;
  vi.clearAllMocks();
});

describe("safeNextPath", () => {
  it.each([
    ["/playground", "/playground"],
    ["/evaluation?tab=results#case-2", "/evaluation?tab=results#case-2"],
  ])("keeps same-origin relative path %s", (value, expected) => {
    expect(safeNextPath(value)).toBe(expected);
  });

  it.each([
    null,
    "",
    "playground",
    "//evil.example/phish",
    "/\\evil.example",
    "/%2F%2Fevil.example",
    "https://evil.example/",
    "javascript:alert(1)",
    "/login",
    "/login?next=/playground",
    "/auth/callback?code=x",
    "/play\nground",
  ])("rejects %s", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });
});

describe("proxy deep links", () => {
  it("sends an unauthenticated deep link to login with a relative next path", async () => {
    const response = await proxy(new NextRequest("https://app.example/playground?tab=answer"));
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://app.example");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/playground?tab=answer");
  });

  it("keeps the root redirect clean", async () => {
    const response = await proxy(new NextRequest("https://app.example/"));
    expect(response.headers.get("location")).toBe("https://app.example/login");
  });

  it("sends an authenticated login visit to the safe next path only", async () => {
    session.authenticated = true;
    const deepLink = await proxy(new NextRequest("https://app.example/login?next=%2Fevaluation"));
    expect(deepLink.headers.get("location")).toBe("https://app.example/evaluation");
    const hostile = await proxy(new NextRequest("https://app.example/login?next=%2F%2Fevil.example"));
    expect(hostile.headers.get("location")).toBe("https://app.example/");
  });

  it("answers an anonymous link-preview crawler at the root without a redirect", async () => {
    const linkedIn = { "user-agent": "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)" };
    const root = await proxy(new NextRequest("https://app.example/", { headers: linkedIn }));
    expect(root.headers.get("location")).toBeNull();
    expect(root.headers.get("x-middleware-rewrite")).toBe("https://app.example/login");

    // Deep links and signed-in crawlers keep the regular flow.
    const deepLink = await proxy(new NextRequest("https://app.example/playground", { headers: linkedIn }));
    expect(deepLink.headers.get("location")).toBe("https://app.example/login?next=%2Fplayground");
    session.authenticated = true;
    expect((await proxy(new NextRequest("https://app.example/", { headers: linkedIn }))).headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("keeps only the Google OAuth routes public under /auth", async () => {
    for (const url of ["https://app.example/auth/google", "https://app.example/auth/callback?code=abc"]) {
      expect((await proxy(new NextRequest(url))).headers.get("location"), url).toBeNull();
    }
    // The removed email confirmation/reset routes are ordinary protected paths now.
    for (const url of ["https://app.example/auth/confirm?token_hash=hash&type=email", "https://app.example/auth/reset-password"]) {
      expect((await proxy(new NextRequest(url))).headers.get("location"), url).toBe("https://app.example/login");
    }
  });

  it("serves metadata images and robots.txt to anonymous link-preview crawlers", async () => {
    for (const url of ["https://app.example/opengraph-image?4f1c", "https://app.example/apple-icon?9a2b", "https://app.example/robots.txt"]) {
      expect((await proxy(new NextRequest(url))).headers.get("location"), url).toBeNull();
    }
    // Prefix lookalikes stay protected routes.
    for (const url of ["https://app.example/opengraph-image-admin", "https://app.example/apple-icons"]) {
      expect((await proxy(new NextRequest(url))).headers.get("location"), url).toContain("/login");
    }
  });
});

describe("Google OAuth next path", () => {
  it("carries a safe next path through the callback in a short-lived cookie", async () => {
    oauth.signInWithOAuth.mockResolvedValue({ data: { url: "https://accounts.example/consent" }, error: null });
    const started = await googleGet(new Request("https://app.example/auth/google?next=%2Fchunking"));
    expect(started.headers.get("location")).toBe("https://accounts.example/consent");
    const cookie = started.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${AUTH_NEXT_COOKIE}=%2Fchunking`);
    expect(cookie.toLowerCase()).toContain("httponly");

    oauth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const finished = await callbackGet(new Request("https://app.example/auth/callback?code=abc", {
      headers: { cookie: `${AUTH_NEXT_COOKIE}=%2Fchunking` },
    }));
    expect(finished.headers.get("location")).toBe("https://app.example/chunking");
  });

  it("expires a next cookie left by an abandoned flow when a new flow targets the root", async () => {
    oauth.signInWithOAuth.mockResolvedValue({ data: { url: "https://accounts.example/consent" }, error: null });
    const restarted = await googleGet(new Request("https://app.example/auth/google", {
      headers: { cookie: `${AUTH_NEXT_COOKIE}=%2Fchunking` },
    }));
    const cookie = restarted.cookies.get(AUTH_NEXT_COOKIE);
    expect(cookie).toMatchObject({ value: "", path: "/auth", maxAge: 0 });
  });

  it("ignores a hostile next path", async () => {
    oauth.signInWithOAuth.mockResolvedValue({ data: { url: "https://accounts.example/consent" }, error: null });
    const started = await googleGet(new Request("https://app.example/auth/google?next=%2F%2Fevil.example"));
    expect(started.headers.get("set-cookie") ?? "").not.toContain("evil");

    oauth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const finished = await callbackGet(new Request("https://app.example/auth/callback?code=abc", {
      headers: { cookie: `${AUTH_NEXT_COOKIE}=%2F%2Fevil.example` },
    }));
    expect(finished.headers.get("location")).toBe("https://app.example/");
  });
});
