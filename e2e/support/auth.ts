import { expect, test, type Page } from "@playwright/test";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export type E2ECredentials = { email: string; password: string };

type SessionCookie = { name: string; value: string; options: CookieOptions };

export function requireE2ECredentials(): E2ECredentials {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_USER_EMAIL and E2E_USER_PASSWORD are required. Do not print their values in logs.");
  }
  return { email, password };
}

function requireSupabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required for programmatic E2E sign-in.");
  }
  return { url, key };
}

/**
 * The product only offers Google OAuth, so the dedicated E2E user (which keeps a password on the
 * hosted project) signs in from Node. The same @supabase/ssr client the app uses writes the
 * session cookies, so their names, chunking and encoding are exactly what the app reads.
 */
async function signInSessionCookies(credentials: E2ECredentials): Promise<SessionCookie[]> {
  const { url, key } = requireSupabasePublicConfig();
  const jar = new Map<string, SessionCookie>();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar.values()].map(({ name, value }) => ({ name, value })),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          if (!cookie.value || cookie.options.maxAge === 0) jar.delete(cookie.name);
          else jar.set(cookie.name, cookie);
        }
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword(credentials);
  // Only the error class/code is reported; credential and token values never reach the logs.
  if (error) throw new Error(`Programmatic E2E sign-in failed (${error.name}${error.code ? `: ${error.code}` : ""}).`);
  if (jar.size === 0) throw new Error("Programmatic E2E sign-in produced no session cookies.");
  return [...jar.values()];
}

function playwrightSameSite(value: CookieOptions["sameSite"]): "Strict" | "Lax" | "None" {
  if (value === "strict" || value === true) return "Strict";
  if (value === "none") return "None";
  return "Lax";
}

/** Adds a real Supabase session for the dedicated E2E user to the page's context and opens the app. */
export async function signIn(page: Page, credentials = requireE2ECredentials()) {
  const baseURL = test.info().project.use.baseURL;
  if (!baseURL) throw new Error("A Playwright baseURL is required for E2E sign-in.");
  const { hostname } = new URL(baseURL);
  const now = Math.floor(Date.now() / 1000);
  const cookies = await signInSessionCookies(credentials);

  await page.context().addCookies(cookies.map(({ name, value, options }) => ({
    name,
    value,
    domain: hostname,
    path: options.path ?? "/",
    httpOnly: options.httpOnly ?? false,
    secure: options.secure ?? false,
    sameSite: playwrightSameSite(options.sameSite),
    expires: options.maxAge ? now + options.maxAge : options.expires ? Math.floor(options.expires.getTime() / 1000) : -1,
  })));
  await page.goto("/");
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
}
