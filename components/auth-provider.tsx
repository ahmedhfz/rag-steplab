"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type AuthBootstrapState = {
  user: User | null;
  userId: string | null;
  ready: boolean;
};

const AuthBootstrapContext = createContext<AuthBootstrapState | null>(null);
const TEST_AUTH_STATE: AuthBootstrapState = { user: null, userId: "test-user", ready: true };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthBootstrapState>({ user: null, userId: null, ready: false });
  const verifiedRef = useRef(false);

  useEffect(() => {
    let active = true;
    try {
      const supabase = getSupabaseBrowserClient();
      void supabase.auth.getUser().then(({ data }) => {
        if (!active) return;
        verifiedRef.current = true;
        setState({ user: data.user, userId: data.user?.id ?? null, ready: true });
      });
      const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
        if (!active || (event === "INITIAL_SESSION" && !verifiedRef.current)) return;
        setState({ user: session?.user ?? null, userId: session?.user.id ?? null, ready: true });
      });
      return () => {
        active = false;
        listener.subscription.unsubscribe();
      };
    } catch {
      queueMicrotask(() => {
        if (active) setState({ user: null, userId: null, ready: true });
      });
      return () => { active = false; };
    }
  }, []);

  return <AuthBootstrapContext.Provider value={state}>{children}</AuthBootstrapContext.Provider>;
}

export function useAuthBootstrap() {
  const state = useContext(AuthBootstrapContext);
  if (state) return state;
  if (process.env.NODE_ENV === "test") return TEST_AUTH_STATE;
  throw new Error("useAuthBootstrap must be used within AuthProvider");
}
