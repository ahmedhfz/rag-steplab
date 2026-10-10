import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("supabase_configuration_missing");
  browserClient = createBrowserClient(url, key, {
    auth: {
      flowType: "pkce",
      experimental: { appendPkceFlowIdToRedirects: true },
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}

export async function getSupabaseAccessToken(): Promise<string | null> {
  const { data, error } = await getSupabaseBrowserClient().auth.getSession();
  if (error) throw new Error("supabase_session_unavailable");
  return data.session?.access_token ?? null;
}

export function supabaseAuthErrorMessage(error: unknown, locale: "en" | "tr" = "tr"): string {
  const value = error instanceof Error ? error.message.toLowerCase() : "";
  if (value.includes("configuration_missing")) return locale === "tr" ? "Kimlik doğrulama yapılandırması eksik." : "Authentication is not configured.";
  if (value.includes("session_unavailable")) return locale === "tr" ? "Oturum doğrulanamadı. Lütfen tekrar deneyin." : "Your session could not be verified. Please try again.";
  return locale === "tr" ? "İşlem tamamlanamadı. Lütfen tekrar deneyin." : "The request could not be completed. Please try again.";
}
