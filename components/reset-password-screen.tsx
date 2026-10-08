"use client";

import { TransitionText } from "@/components/ui/transitions";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { shakeValidation } from "@/lib/transitions";
import { AuthShell } from "@/components/auth-shell";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient, supabaseAuthErrorMessage } from "@/lib/supabase/browser";

export function ResetPasswordScreen() {
  const { preferences } = usePreferences();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isTurkish = preferences.locale === "tr";
    if (password.length < 10) return setStatus(isTurkish ? "Şifreniz en az 10 karakter olmalı." : "Your password must be at least 10 characters.");
    if (password !== confirmation) { shakeValidation(document.getElementById("reset-password-confirmation")); return setStatus(isTurkish ? "Şifreler eşleşmiyor." : "The passwords do not match."); }
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

  const labels = preferences.locale === "tr"
    ? { form: "Şifre yenileme formu", title: "Yeni şifre oluştur", description: "Hesabınız için yeni bir şifre belirleyin.", password: "Yeni şifre", confirmation: "Yeni şifre tekrarı", passwordPlaceholder: "Yeni şifreniz", confirmationPlaceholder: "Yeni şifrenizi tekrar girin", submit: "Şifreyi güncelle", busy: "Kaydediliyor…" }
    : { form: "Password reset form", title: "Create a new password", description: "Choose a new password for your account.", password: "New password", confirmation: "Confirm new password", passwordPlaceholder: "Your new password", confirmationPlaceholder: "Repeat your new password", submit: "Update password", busy: "Saving…" };

  return (
    <AuthShell>
      <section aria-label={labels.form} className="w-full max-w-[360px]">
        <h1 className="text-[24px] font-semibold leading-[29px] tracking-[-0.48px] text-foreground">{labels.title}</h1>
        <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{labels.description}</p>
        <form aria-describedby="reset-password-status" className="mt-7" onSubmit={submit}>
          <div className="space-y-2">
            <label className="text-[13px] font-medium leading-[19px] text-foreground" htmlFor="reset-password">{labels.password}</label>
            <Input aria-label={labels.password} autoComplete="new-password" className="h-[44px] rounded-[10px] border-[1.5px] border-input bg-card px-3 text-[13px] shadow-none placeholder:text-subtle-foreground focus-visible:border-brand focus-visible:ring-ring/15" id="reset-password" minLength={10} onChange={(event) => setPassword(event.target.value)} placeholder={labels.passwordPlaceholder} required type="password" value={password} />
          </div>
          <div className="mt-4 space-y-2">
            <label className="text-[13px] font-medium leading-[19px] text-foreground" htmlFor="reset-password-confirmation">{labels.confirmation}</label>
            <Input aria-label={labels.confirmation} autoComplete="new-password" className="h-[44px] rounded-[10px] border-[1.5px] border-input bg-card px-3 text-[13px] shadow-none placeholder:text-subtle-foreground focus-visible:border-brand focus-visible:ring-ring/15" id="reset-password-confirmation" minLength={10} onChange={(event) => setConfirmation(event.target.value)} placeholder={labels.confirmationPlaceholder} required type="password" value={confirmation} />
          </div>
          <Button className="mt-6 h-[43px] w-full rounded-[10px] bg-foreground text-[13px] font-medium text-primary-foreground hover:bg-strong-hover" disabled={busy} type="submit"><TransitionText>{busy ? labels.busy : labels.submit}</TransitionText></Button>
        </form>
        <p aria-live="polite" className="mt-4 min-h-5 text-center text-xs leading-5 text-muted-foreground" id="reset-password-status" role="status"><TransitionText>{status}</TransitionText></p>
      </section>
    </AuthShell>
  );
}

