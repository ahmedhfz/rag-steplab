"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient, supabaseAuthErrorMessage } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

function StepLabMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={cn("size-8", className)} fill="none" viewBox="0 0 24 24">
      <path d="M6.5 4.5h11v5.25A4.75 4.75 0 0 1 12.75 14h-1.5A4.75 4.75 0 0 1 6.5 9.75V4.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M6.5 8.25h11M9.5 14v5.5h5V14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="size-[17px]" viewBox="0 0 24 24">
      <path d="M21.35 12.23c0-.73-.06-1.43-.19-2.1H12v3.98h5.23a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.69 2.92-4.18 2.92-7.27Z" fill="#4285F4" />
      <path d="M12 21.6c2.63 0 4.83-.87 6.43-2.36l-3.14-2.45c-.87.58-1.98.92-3.29.92-2.53 0-4.68-1.71-5.45-4.01H3.3v2.53A9.71 9.71 0 0 0 12 21.6Z" fill="#34A853" />
      <path d="M6.55 13.7a5.84 5.84 0 0 1 0-3.4V7.77H3.3a9.71 9.71 0 0 0 0 8.46l3.25-2.53Z" fill="#FBBC05" />
      <path d="M12 6.29c1.43 0 2.72.49 3.73 1.45l2.8-2.8C16.82 3.36 14.62 2.4 12 2.4a9.71 9.71 0 0 0-8.7 5.37l3.25 2.53c.77-2.3 2.92-4.01 5.45-4.01Z" fill="#EA4335" />
    </svg>
  );
}

type Mode = "signin" | "signup" | "forgot";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  confirmation_invalid_or_expired: "Doğrulama bağlantısı geçersiz veya süresi dolmuş.",
  recovery_invalid_or_expired: "Şifre yenileme bağlantısı geçersiz veya süresi dolmuş.",
  oauth_failed: "Google ile giriş tamamlanamadı. Lütfen tekrar deneyin.",
};

const subscribeToAuthError = () => () => undefined;

function getAuthErrorMessage() {
  if (typeof window === "undefined") return "";
  const code = new URLSearchParams(window.location.search).get("auth_error");
  return AUTH_ERROR_MESSAGES[code ?? ""] ?? "";
}

function getServerAuthErrorMessage() {
  return "";
}

function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("invalid login credentials")) return "E-posta veya şifre hatalı.";
  if (message.includes("user already registered") || message.includes("already been registered")) return "Bu e-posta ile kayıtlı bir hesap zaten var.";
  if (message.includes("email not confirmed")) return "Devam etmek için e-posta adresinizi doğrulayın.";
  if (message.includes("password")) return "Şifre gereksinimleri karşılanmıyor.";
  if (message.includes("rate limit") || message.includes("too many")) return "Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.";
  return supabaseAuthErrorMessage(error);
}

export function LoginScreen() {
  const router = useRouter();
  const urlStatusMessage = useSyncExternalStore(subscribeToAuthError, getAuthErrorMessage, getServerAuthErrorMessage);
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setAuthMode(nextMode: Mode) {
    setMode(nextMode);
    setStatusMessage("");
    setPassword("");
    setConfirmation("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatusMessage("");
    try {
        const supabase = getSupabaseBrowserClient();
        if (mode === "forgot") {
          const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/auth/confirm?next=/auth/reset-password`,
          });
        if (error) throw error;
        setStatusMessage("Şifre yenileme bağlantısı e-posta adresinize gönderildi.");
        return;
      }
      if (mode === "signup") {
        if (password.length < 10) {
          setStatusMessage("Şifreniz en az 10 karakter olmalı.");
          return;
        }
        if (password !== confirmation) {
          setStatusMessage("Şifreler eşleşmiyor.");
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
        });
        if (error) throw error;
        if (data.session) router.replace("/");
        else setStatusMessage("Kayıt tamamlandı. Devam etmek için e-posta adresinizi doğrulayın.");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/");
    } catch (error) {
      setStatusMessage(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "signup" ? "Hesap oluşturun" : mode === "forgot" ? "Şifrenizi yenileyin" : "Hesabınıza giriş yapın";
  const submitLabel = mode === "signup" ? "Kayıt ol" : mode === "forgot" ? "Bağlantı gönder" : "Giriş yap";

  return (
    <div className="flex min-h-screen flex-col bg-[#fbfcfe] text-[#172033]">
      <header className="flex h-[66px] shrink-0 items-center border-b border-slate-200/80 bg-white px-4 sm:px-8">
        <Link aria-label="RAG StepLab ana sayfa" className="flex items-center gap-3" href="/"><StepLabMark className="size-7" /><span className="text-[15px] font-semibold tracking-[-0.025em] text-slate-900">RAG StepLab</span></Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:py-10">
        <section aria-label="Giriş formu" className="w-full max-w-[350px] overflow-hidden rounded-[5px] border border-slate-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.03)]">
          <div className="px-6 pb-6 pt-7">
            <div className="flex flex-col items-center text-center"><StepLabMark className="size-8 text-slate-900" /><h1 className="mt-2 text-[21px] font-semibold tracking-[-0.04em] text-slate-900">RAG StepLab</h1><p className="mt-1 text-xs text-slate-500">{title}</p></div>
            <form aria-describedby="login-status" className="mt-6 space-y-4" onSubmit={submit}>
              <div className="space-y-1.5"><label className="text-[11px] font-semibold text-slate-700" htmlFor="login-email">E-posta</label><div className="relative"><Mail aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" /><Input autoComplete="email" className="h-8 border-slate-200 pl-8 pr-3 text-xs shadow-none placeholder:text-[11px] focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-200" id="login-email" onChange={(event) => setEmail(event.target.value)} placeholder="ornek@firma.com" required type="email" value={email} /></div></div>
              {mode !== "forgot" && <div className="space-y-1.5"><label className="text-[11px] font-semibold text-slate-700" htmlFor="login-password">Şifre</label><div className="relative"><LockKeyhole aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" /><Input autoComplete={mode === "signup" ? "new-password" : "current-password"} className="h-8 border-slate-200 pl-8 pr-9 text-xs shadow-none placeholder:text-[11px] focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-200" id="login-password" minLength={mode === "signup" ? 10 : undefined} onChange={(event) => setPassword(event.target.value)} placeholder="Şifrenizi girin" required type={showPassword ? "text" : "password"} value={password} /><button aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"} className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-slate-500 outline-none transition-colors hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-300" onClick={() => setShowPassword((current) => !current)} type="button">{showPassword ? <EyeOff aria-hidden="true" className="size-3.5" /> : <Eye aria-hidden="true" className="size-3.5" />}</button></div></div>}
              {mode === "signup" && <div className="space-y-1.5"><label className="text-[11px] font-semibold text-slate-700" htmlFor="login-password-confirm">Şifre tekrarı</label><Input autoComplete="new-password" className="h-8 border-slate-200 text-xs shadow-none placeholder:text-[11px] focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-200" id="login-password-confirm" minLength={10} onChange={(event) => setConfirmation(event.target.value)} placeholder="Şifrenizi tekrar girin" required type="password" value={confirmation} /></div>}
              <Button className="h-9 w-full bg-[#4b5c74] text-xs font-semibold text-white hover:bg-[#405069]" disabled={busy} type="submit">{busy ? "Bekleyin…" : submitLabel}</Button>
            </form>
            {mode === "signin" && <><div className="my-6 flex items-center gap-3 text-[10px] text-slate-500"><span aria-hidden="true" className="h-px flex-1 bg-slate-200" /><span>veya</span><span aria-hidden="true" className="h-px flex-1 bg-slate-200" /></div><Button asChild className="h-9 w-full border-slate-200 bg-white text-xs font-medium text-slate-800 shadow-none hover:bg-slate-50" variant="outline"><a href="/auth/google"><GoogleMark />Google ile devam et</a></Button><div className="mt-5 text-center"><button className="text-xs font-medium text-blue-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200" onClick={() => setAuthMode("forgot")} type="button">Şifremi unuttum</button></div></>}
            {mode !== "signin" && <div className="mt-5 text-center"><button className="text-xs font-medium text-blue-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200" onClick={() => setAuthMode("signin")} type="button">Giriş ekranına dön</button></div>}
            <p aria-live="polite" className="mt-3 min-h-4 text-center text-[10px] leading-4 text-slate-500" id="login-status" role="status">{statusMessage ?? urlStatusMessage}</p>
          </div>
          {mode === "signin" ? <div className="border-t border-slate-200 px-6 py-6 text-center text-xs text-slate-500"><span>Hesabın yok mu?</span>{" "}<button className="font-medium text-blue-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200" onClick={() => setAuthMode("signup")} type="button">Kayıt ol</button></div> : null}
        </section>
      </main>
      <footer className="flex min-h-[50px] shrink-0 items-center justify-center gap-2 border-t border-slate-200/80 bg-white px-4 text-[10px] text-slate-500 sm:text-[11px]"><span>RAG öğrenme laboratuvarı</span><span aria-hidden="true">•</span><span>Backend: canlı RAG API</span></footer>
    </div>
  );
}
