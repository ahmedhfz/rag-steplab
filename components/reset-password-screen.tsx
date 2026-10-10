"use client";

import { TransitionText } from "@/components/ui/transitions";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { shakeValidation } from "@/lib/transitions";
import { AuthShell } from "@/components/auth-shell";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/lib/copy";
import { getSupabaseBrowserClient, supabaseAuthErrorMessage } from "@/lib/supabase/browser";

export function ResetPasswordScreen() {
  const { preferences } = usePreferences();
  const auth = useCopy().auth;
  const labels = auth.reset;
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 10) return setStatus(auth.messages.passwordTooShort);
    if (password !== confirmation) { shakeValidation(document.getElementById("reset-password-confirmation")); return setStatus(auth.messages.passwordMismatch); }
    setBusy(true);
    setStatus("");
    try {
      const { error } = await getSupabaseBrowserClient().auth.updateUser({ password });
      if (error) throw error;
      router.replace("/");
    } catch (error) {
      setStatus(supabaseAuthErrorMessage(error, preferences.locale));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <section aria-label={labels.form} className="w-full max-w-[360px]">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{labels.title}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{labels.description}</p>
        <form aria-describedby="reset-password-status" className="mt-7" onSubmit={submit}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="reset-password">{labels.password}</label>
            <Input aria-label={labels.password} autoComplete="new-password" className="h-10" id="reset-password" minLength={10} onChange={(event) => setPassword(event.target.value)} placeholder={labels.passwordPlaceholder} required type="password" value={password} />
          </div>
          <div className="mt-4 space-y-2">
            <label className="text-sm font-medium text-foreground" htmlFor="reset-password-confirmation">{labels.confirmation}</label>
            <Input aria-label={labels.confirmation} autoComplete="new-password" className="h-10" id="reset-password-confirmation" minLength={10} onChange={(event) => setConfirmation(event.target.value)} placeholder={labels.confirmationPlaceholder} required type="password" value={confirmation} />
          </div>
          <Button className="mt-6 w-full" size="lg" disabled={busy} type="submit"><TransitionText>{busy ? labels.busy : labels.submit}</TransitionText></Button>
        </form>
        <p aria-live="polite" className="mt-4 min-h-5 text-center text-xs leading-5 text-muted-foreground" id="reset-password-status" role="status"><TransitionText>{status}</TransitionText></p>
      </section>
    </AuthShell>
  );
}

