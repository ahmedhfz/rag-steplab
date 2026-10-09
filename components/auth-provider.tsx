"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type AuthBootstrapState = {
  user: User | null;
  userId: string | null;
  ready: boolean;
  /** True when the auth check itself failed (network/configuration), as opposed to "signed out". */
  error: boolean;
};

type AuthBootstrapValue = AuthBootstrapState & {
  /** Re-runs the authoritative user check after a failure. */
  retry: () => void;
};

const AuthBootstrapContext = createContext<AuthBootstrapValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthBootstrapState>({ user: null, userId: null, ready: false, error: false });
  const [attempt, setAttempt] = useState(0);
  const verifiedRef = useRef(false);

  useEffect(() => {
    let active = true;
    try {
      const supabase = getSupabaseBrowserClient();
      supabase.auth.getUser().then(({ data, error }) => {
        if (!active) return;
        verifiedRef.current = true;
        // A missing session is a normal signed-out state; any other failure is retryable.
        const failed = Boolean(error && error.name !== "AuthSessionMissingError");
        setState({ user: data.user, userId: data.user?.id ?? null, ready: true, error: failed });
      }, () => {
        if (active) setState({ user: null, userId: null, ready: true, error: true });
      });
      const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
        if (!active || (event === "INITIAL_SESSION" && !verifiedRef.current)) return;
        setState({ user: session?.user ?? null, userId: session?.user.id ?? null, ready: true, error: false });
      });
      return () => {
        active = false;
        listener.subscription.unsubscribe();
      };
    } catch {
      queueMicrotask(() => {
        if (active) setState({ user: null, userId: null, ready: true, error: true });
      });
      return () => { active = false; };
    }
  }, [attempt]);

  const retry = useCallback(() => {
    verifiedRef.current = false;
    setState((current) => current.ready && !current.userId ? { ...current, ready: false, error: false } : current);
    setAttempt((current) => current + 1);
  }, []);

  const value = useMemo(() => ({ ...state, retry }), [retry, state]);
  return <AuthBootstrapContext.Provider value={value}>{children}</AuthBootstrapContext.Provider>;
}

export function useAuthBootstrap() {
  const state = useContext(AuthBootstrapContext);
  if (!state) throw new Error("useAuthBootstrap must be used within AuthProvider");
  return state;
}
