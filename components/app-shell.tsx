"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Beaker,
  BookOpen,
  CircleHelp,
  FileText,
  Grid2X2,
  Home,
  LogOut,
  Menu,
  Search,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { usePreferences } from "@/components/preferences-provider";
import { PageTransition } from "@/components/page-transition";
import { Button } from "@/components/ui/button";
import { type AppCopy, type AppNavKey, UI_COPY } from "@/lib/copy";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

const navItems: Array<{ key: AppNavKey; href: string; icon: LucideIcon }> = [
  { key: "overview", href: "/", icon: Home },
  { key: "documents", href: "/documents", icon: FileText },
  { key: "chunks", href: "/documents/chunks", icon: Grid2X2 },
  { key: "retrieval", href: "/retrieval", icon: Search },
  { key: "evaluation", href: "/evaluation", icon: BarChart3 },
  { key: "settings", href: "/settings", icon: Settings },
];

function isNavItemActive(key: AppNavKey, pathname: string) {
  if (key === "overview") return pathname === "/";
  if (key === "documents") return pathname === "/documents" || pathname === "/documents/parsed";
  if (key === "chunks") return pathname === "/documents/chunks";
  return pathname === `/${key}`;
}

type AuthUserSummary = {
  email: string | null;
  name: string | null;
};

function getAuthUserSummary(user: { email?: string; user_metadata?: Record<string, unknown> } | null | undefined): AuthUserSummary {
  const metadata = user?.user_metadata;
  const name = [metadata?.full_name, metadata?.name, metadata?.user_name, metadata?.preferred_username]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)
    ?.trim() ?? null;

  return { email: user?.email ?? null, name };
}

function getInitials(name: string | null, email: string | null) {
  const source = name?.trim() || email?.split("@")[0]?.trim() || "";
  if (!source) return "RL";

  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  return source.slice(0, 2).toUpperCase();
}

type UserMenuItemProps = {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  href?: string;
};

function UserMenuItem({ icon: Icon, label, onClick, href }: UserMenuItemProps) {
  const className = "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300";

  if (href) {
    return <Link className={className} href={href} onClick={onClick}><Icon aria-hidden="true" className="size-4 text-slate-500" />{label}</Link>;
  }

  return <button className={className} onClick={onClick} type="button"><Icon aria-hidden="true" className="size-4 text-slate-500" />{label}</button>;
}

type UserMenuProps = {
  copy: AppCopy;
  user: AuthUserSummary;
  onNavigate?: () => void;
  onSignOut: () => Promise<void>;
};

function UserMenu({ copy, user, onNavigate, onSignOut }: UserMenuProps) {
  const [openView, setOpenView] = useState<"menu" | "guides" | "help" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isOpen = openView !== null;
  const displayName = user.name ?? user.email ?? copy.productName;
  const initials = getInitials(user.name, user.email);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpenView(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      if (openView === "menu") {
        setOpenView(null);
        triggerRef.current?.focus();
      } else {
        setOpenView("menu");
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, openView]);

  function closeAfterNavigation() {
    setOpenView(null);
    onNavigate?.();
  }

  async function handleSignOut() {
    setOpenView(null);
    await onSignOut();
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`${displayName} — ${copy.common.accountMenu}`}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-slate-300"
        onClick={() => setOpenView(isOpen ? null : "menu")}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{initials}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-800">{displayName}</span>
          <span className="block truncate text-xs text-slate-500">{user.email ?? copy.common.frontendFoundation}</span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            aria-label={copy.common.accountMenu}
            className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-50 overflow-hidden rounded-lg border bg-white p-1.5 shadow-lg"
            exit={{ opacity: 0, y: 4 }}
            initial={{ opacity: 0, y: 4 }}
            role="dialog"
            transition={{ duration: 0.14, ease: "easeOut" }}
          >
            {openView === "menu" && (
              <>
                <div className="mb-1 border-b px-2.5 pb-2.5 pt-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{displayName}</p>
                  <p className="truncate text-xs text-slate-500">{user.email ?? copy.common.frontendFoundation}</p>
                </div>
                <UserMenuItem icon={BookOpen} label={copy.guides} onClick={() => setOpenView("guides")} />
                <UserMenuItem icon={CircleHelp} label={copy.help} onClick={() => setOpenView("help")} />
                <UserMenuItem href="/settings" icon={Settings} label={copy.nav.settings} onClick={closeAfterNavigation} />
                <div className="my-1 border-t" />
                <UserMenuItem icon={LogOut} label={copy.common.signOut} onClick={() => void handleSignOut()} />
              </>
            )}

            {openView === "guides" && (
              <div className="p-1">
                <button className="mb-2 flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={() => setOpenView("menu")} type="button">
                  <ArrowLeft aria-hidden="true" className="size-3.5" />
                  {copy.common.back}
                </button>
                <h2 className="px-1.5 text-sm font-semibold text-slate-900">{copy.guidePanel.title}</h2>
                <p className="px-1.5 pt-1.5 text-xs leading-5 text-slate-600">{copy.guidePanel.description}</p>
                <nav aria-label={copy.guides} className="mt-3 grid gap-1 border-t pt-2 text-sm">
                  <Link className="rounded px-2 py-1.5 hover:bg-slate-100" href="/" onClick={closeAfterNavigation}>{copy.nav.overview}</Link>
                  <Link className="rounded px-2 py-1.5 hover:bg-slate-100" href="/documents" onClick={closeAfterNavigation}>{copy.nav.documents}</Link>
                  <Link className="rounded px-2 py-1.5 hover:bg-slate-100" href="/retrieval" onClick={closeAfterNavigation}>{copy.nav.retrieval}</Link>
                </nav>
              </div>
            )}

            {openView === "help" && (
              <div className="p-1">
                <button className="mb-2 flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={() => setOpenView("menu")} type="button">
                  <ArrowLeft aria-hidden="true" className="size-3.5" />
                  {copy.common.back}
                </button>
                <h2 className="px-1.5 text-sm font-semibold text-slate-900">{copy.helpPanel.title}</h2>
                <p className="px-1.5 pt-1.5 text-xs leading-5 text-slate-600">{copy.helpPanel.description}</p>
                <Link className="mt-3 inline-flex border-t px-1.5 pt-2 text-sm font-medium text-slate-900 underline-offset-4 hover:underline" href="/settings" onClick={closeAfterNavigation}>
                  {copy.helpPanel.settingsLink}
                </Link>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Sidebar({ pathname, onNavigate, copy, user, onSignOut }: { pathname: string; onNavigate?: () => void; copy: AppCopy; user: AuthUserSummary; onSignOut: () => Promise<void> }) {
  return (
    <div className="flex h-full flex-col bg-[#fcfcfd]">
      <div className="flex h-[74px] items-center gap-3 border-b px-6">
        <Beaker aria-hidden="true" className="size-7 stroke-[1.7]" />
        <span className="text-[21px] font-semibold tracking-[-0.03em]">{copy.productName}</span>
      </div>

      <nav aria-label={copy.common.primaryNavigation} className="flex-1 space-y-1.5 px-3 py-5">
        {navItems.map((item) => {
          const isActive = isNavItemActive(item.key, pathname);
          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-3 rounded-md px-3 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-950",
                isActive && "bg-slate-100 font-medium text-slate-950",
              )}
              href={item.href}
              key={item.key}
              onClick={onNavigate}
            >
              <item.icon aria-hidden="true" className="size-[19px] stroke-[1.65]" />
              {copy.nav[item.key]}
            </Link>
          );
        })}
      </nav>

      <div className="border-t px-3 py-3">
        <UserMenu copy={copy} onNavigate={onNavigate} onSignOut={onSignOut} user={user} />
      </div>
    </div>
  );
}

function getPageTitle(pathname: string, copy: AppCopy) {
  if (pathname === "/") return copy.nav.overview;
  if (pathname === "/documents/chunks") return copy.nav.chunks;
  if (pathname.startsWith("/documents")) return copy.nav.documents;
  if (pathname === "/retrieval") return copy.nav.retrieval;
  if (pathname === "/evaluation") return copy.nav.evaluation;
  if (pathname === "/settings") return copy.nav.settings;
  return copy.productName;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileOpenButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const mobilePanelRef = useRef<HTMLElement>(null);
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const router = useRouter();
  const [authUser, setAuthUser] = useState<AuthUserSummary>({ email: null, name: null });

  useEffect(() => {
    let active = true;
    try {
      const supabase = getSupabaseBrowserClient();
      void supabase.auth.getUser().then(({ data }) => {
        if (active) setAuthUser(getAuthUserSummary(data.user));
      });
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) setAuthUser(getAuthUserSummary(session?.user));
      });
      return () => {
        active = false;
        listener.subscription.unsubscribe();
      };
    } catch {
      return () => { active = false; };
    }
  }, []);

  async function signOut() {
    try {
      await getSupabaseBrowserClient().auth.signOut();
    } finally {
      router.replace("/login");
    }
  }
  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    const openButton = mobileOpenButtonRef.current;
    document.body.style.overflow = "hidden";

    mobileCloseButtonRef.current?.focus();

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      setMobileOpen(false);
    }

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
      openButton?.focus();
    };
  }, [mobileOpen]);

  function trapMobileFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;

    const focusableElements = mobilePanelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusableElements?.length) return;

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (activeElement === last && !event.shiftKey) {
      event.preventDefault();
      first.focus();
    } else if (activeElement === first && event.shiftKey) {
      event.preventDefault();
      last.focus();
    }
  }

  if (pathname === "/login" || pathname === "/auth/reset-password") {
    return (
      <MotionConfig reducedMotion="never">
        <PageTransition>{children}</PageTransition>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="never">
      <div className="min-h-screen bg-[#fdfdfd] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] border-r lg:block">
        <Sidebar copy={copy} onSignOut={signOut} pathname={pathname} user={authUser} />
      </aside>

      <div
        aria-hidden={!mobileOpen}
        className="fixed inset-0 z-50 pointer-events-none lg:hidden"
        id="mobile-navigation"
        onKeyDown={trapMobileFocus}
      >
        <AnimatePresence initial={false}>
          {mobileOpen && (
            <motion.button
              aria-label={copy.common.close}
              animate={{ opacity: 1 }}
              className="pointer-events-auto absolute inset-0 bg-black/20"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key="mobile-backdrop"
              onClick={() => setMobileOpen(false)}
              type="button"
            />
          )}
          {mobileOpen && (
            <motion.aside
              animate={{ opacity: 1, x: 0 }}
              aria-label={copy.common.primaryNavigation}
              aria-modal="true"
              className="pointer-events-auto relative h-full w-[min(86vw,280px)] border-r bg-white"
              exit={{ opacity: 0, x: -20 }}
              initial={{ opacity: 0, x: -20 }}
              key="mobile-panel"
              ref={mobilePanelRef}
              role="dialog"
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <Button aria-label={copy.common.close} autoFocus className="absolute right-3 top-4 z-10" onClick={() => setMobileOpen(false)} ref={mobileCloseButtonRef} size="icon" variant="ghost">
                <X aria-hidden="true" className="size-5" />
              </Button>
              <Sidebar copy={copy} onNavigate={() => setMobileOpen(false)} onSignOut={signOut} pathname={pathname} user={authUser} />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      <div className="min-w-0 lg:pl-[232px]">
        <header className="sticky top-0 z-30 flex h-[74px] items-center justify-between border-b bg-white px-4 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Button aria-controls="mobile-navigation" aria-expanded={mobileOpen} aria-label={copy.common.openNavigation} className="lg:hidden" onClick={() => setMobileOpen(true)} ref={mobileOpenButtonRef} size="icon" variant="ghost">
              <Menu className="size-5" />
            </Button>
            <span className="truncate text-lg font-semibold tracking-[-0.02em]">{getPageTitle(pathname, copy)}</span>
            <span className="hidden rounded-md border bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 sm:inline-flex">
              {copy.learningMode}: {copy.detailLevel[preferences.detailLevel]}
            </span>
          </div>
        </header>

        <main className="min-w-0">
          <PageTransition>{children}</PageTransition>
        </main>
        <footer className="flex min-h-10 items-center justify-center gap-2 border-t px-4 text-[11px] text-slate-500">
          <span>{copy.footer.localProject}</span>
          <span aria-hidden="true">•</span>
          <span>{copy.footer.backendStatus}</span>
        </footer>
      </div>
      </div>
    </MotionConfig>
  );
}
