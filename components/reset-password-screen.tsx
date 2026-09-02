"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
    if (password !== confirmation) return setStatus(isTurkish ? "Şifreler eşleşmiyor." : "The passwords do not match.");
    setBusy(true);
    setStatus("");
    try {
      const { error } = await getSupabaseBrowserClient().auth.updateUser({ password });
      if (error) throw error;
      router.replace("/");
    } catch (error) {
      setStatus(supabaseAuthErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const labels = preferences.locale === "tr"
    ? { form: "Şifre yenileme formu", title: "Yeni şifre oluştur", description: "Hesabınız için yeni bir şifre belirleyin.", password: "Yeni şifre", confirmation: "Yeni şifre tekrarı", passwordPlaceholder: "Yeni şifreniz", confirmationPlaceholder: "Yeni şifrenizi tekrar girin", submit: "Şifreyi güncelle", busy: "Kaydediliyor…" }
    : { form: "Password reset form", title: "Create a new password", description: "Choose a new password for your account.", password: "New password", confirmation: "Confirm new password", passwordPlaceholder: "Your new password", confirmationPlaceholder: "Repeat your new password", submit: "Update password", busy: "Saving…" };

  return (
    <AuthShell>
      <section aria-label={labels.form} className="w-full max-w-[430px] rounded-[16px] border border-border bg-card p-6 shadow-[0_12px_35px_rgba(23,20,22,0.04)] sm:p-9">
        <div className="border-b border-border pb-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.13em] text-brand">RAG StepLab</p>
          <h1 className="mt-3 text-[27px] font-semibold tracking-[-0.045em] text-foreground">{labels.title}</h1>
          <p className="mt-2 text-sm leading-5 text-muted-foreground">{labels.description}</p>
        </div>
        <form aria-describedby="reset-password-status" className="mt-6 space-y-4" onSubmit={submit}>
          <div className="space-y-2"><label className="text-xs font-medium text-foreground" htmlFor="reset-password">{labels.password}</label><Input aria-label={labels.password} autoComplete="new-password" className="h-11 border-input bg-card text-sm shadow-none placeholder:text-subtle-foreground focus-visible:border-brand focus-visible:ring-ring/15" id="reset-password" minLength={10} onChange={(event) => setPassword(event.target.value)} placeholder={labels.passwordPlaceholder} required type="password" value={password} /></div>
          <div className="space-y-2"><label className="text-xs font-medium text-foreground" htmlFor="reset-password-confirmation">{labels.confirmation}</label><Input aria-label={labels.confirmation} autoComplete="new-password" className="h-11 border-input bg-card text-sm shadow-none placeholder:text-subtle-foreground focus-visible:border-brand focus-visible:ring-ring/15" id="reset-password-confirmation" minLength={10} onChange={(event) => setConfirmation(event.target.value)} placeholder={labels.confirmationPlaceholder} required type="password" value={confirmation} /></div>
          <Button className="h-11 w-full bg-foreground text-sm font-semibold text-primary-foreground hover:bg-strong-hover" disabled={busy} type="submit">{busy ? labels.busy : labels.submit}</Button>
        </form>
        <p aria-live="polite" className="mt-4 min-h-5 text-center text-xs leading-5 text-muted-foreground" id="reset-password-status" role="status">{status}</p>
      </section>
    </AuthShell>
  );
}
