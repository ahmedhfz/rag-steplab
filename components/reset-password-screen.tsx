"use client";

import { TransitionText } from "@/components/ui/transitions";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { shakeValidation } from "@/lib/transitions";
import { AuthShell, MIN_PASSWORD_LENGTH } from "@/components/auth-shell";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { interpolate, useCopy } from "@/lib/copy";
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
    if (password.length < MIN_PASSWORD_LENGTH) return setStatus(interpolate(auth.messages.passwordTooShort, { min: MIN_PASSWORD_LENGTH }));
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
      <section aria-label={labels.form} className="w-full max-w-sm">
        <h1 className="text-display-xs font-semibold text-primary">{labels.title}</h1>
        <form aria-describedby="reset-password-status" className="mt-8 flex flex-col gap-5" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-password">{labels.password}</Label>
            <Input aria-label={labels.password} autoComplete="new-password" id="reset-password" minLength={MIN_PASSWORD_LENGTH} onChange={(event) => setPassword(event.target.value)} placeholder={auth.login.passwordPlaceholder} required size="lg" type="password" value={password} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-password-confirmation">{labels.confirmation}</Label>
            <Input aria-label={labels.confirmation} autoComplete="new-password" id="reset-password-confirmation" minLength={MIN_PASSWORD_LENGTH} onChange={(event) => setConfirmation(event.target.value)} placeholder={auth.login.passwordPlaceholder} required size="lg" type="password" value={confirmation} />
          </div>
          <Button className="mt-1 w-full" disabled={busy} size="lg" type="submit"><TransitionText>{busy ? labels.busy : labels.submit}</TransitionText></Button>
        </form>
        <p aria-live="polite" className={status ? "mt-5 rounded-lg bg-secondary px-3.5 py-2.5 text-center text-sm text-secondary" : "mt-5 min-h-5"} id="reset-password-status" role="status"><TransitionText>{status}</TransitionText></p>
      </section>
    </AuthShell>
  );
}
