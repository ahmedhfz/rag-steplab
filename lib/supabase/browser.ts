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
