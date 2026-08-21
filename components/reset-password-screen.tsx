"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient, supabaseAuthErrorMessage } from "@/lib/supabase/browser";

export function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 10) return setStatus("Şifreniz en az 10 karakter olmalı.");
    if (password !== confirmation) return setStatus("Şifreler eşleşmiyor.");
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfcfe] px-4">
      <section aria-label="Şifre yenileme formu" className="w-full max-w-[350px] rounded-[5px] border border-slate-200 bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
        <h1 className="text-center text-[21px] font-semibold tracking-[-0.04em] text-slate-900">Yeni şifre oluştur</h1>
        <p className="mt-2 text-center text-xs text-slate-500">Hesabınız için yeni bir şifre belirleyin.</p>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <Input aria-label="Yeni şifre" autoComplete="new-password" minLength={10} onChange={(event) => setPassword(event.target.value)} placeholder="Yeni şifreniz" required type="password" value={password} />
          <Input aria-label="Yeni şifre tekrarı" autoComplete="new-password" minLength={10} onChange={(event) => setConfirmation(event.target.value)} placeholder="Yeni şifrenizi tekrar girin" required type="password" value={confirmation} />
          <Button className="h-9 w-full bg-[#4b5c74] text-xs font-semibold text-white hover:bg-[#405069]" disabled={busy} type="submit">{busy ? "Kaydediliyor…" : "Şifreyi güncelle"}</Button>
        </form>
        <p aria-live="polite" className="mt-4 min-h-4 text-center text-[10px] leading-4 text-slate-500" role="status">{status}</p>
      </section>
    </div>
  );
}
