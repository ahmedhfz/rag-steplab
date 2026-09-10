"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Braces,
  BookOpen,
  CircleHelp,
  FileText,
  Grid2X2,
  Home,
  LogOut,
  ListFilter,
  Menu,
  Search,
  Settings,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuthBootstrap } from "@/components/auth-provider";
import { usePreferences } from "@/components/preferences-provider";
import { PageTransition } from "@/components/page-transition";
import { Button } from "@/components/ui/button";
import { type AppCopy, type AppNavKey, UI_COPY } from "@/lib/copy";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { UI_ASSETS } from "@/lib/ui-assets";
import { cn } from "@/lib/utils";

type NavItem = { key: AppNavKey; href: string; icon: LucideIcon };
type NavGroup = { label?: "pipeline" | "experiment" | "system"; items: NavItem[] };

const navGroups: NavGroup[] = [
  { items: [{ key: "overview", href: "/", icon: Home }] },
  {
    label: "pipeline",
    items: [
      { key: "documents", href: "/documents", icon: FileText },
      { key: "parse", href: "/parse", icon: ListFilter },
      { key: "chunking", href: "/chunking", icon: Grid2X2 },
      { key: "embeddings", href: "/embeddings", icon: Braces },
    ],
  },
  {
    label: "experiment",
    items: [
      { key: "playground", href: "/playground", icon: Search },
      { key: "evaluation", href: "/evaluation", icon: BarChart3 },
    ],
  },
];

const settingsNavItem: NavItem = { key: "settings", href: "/settings", icon: Settings };

const navIconAssets: Partial<Record<AppNavKey, string>> = {
  overview: "/assets/figma/overview/overview.svg",
  documents: "/assets/figma/overview/documents.svg",
  parse: "/assets/figma/overview/parsing.svg",
  chunking: "/assets/figma/overview/chunking.svg",
  embeddings: "/assets/figma/overview/embeddings.svg",
  playground: "/assets/figma/overview/playground.svg",
  evaluation: "/assets/figma/overview/evaluation.svg",
  settings: "/assets/figma/overview/settings.svg",
};

function ThemedAssetIcon({ src }: { src: string }) {
  const maskImage = `url("${src}")`;
  return (
    <span
      aria-hidden="true"
      className="block size-[17.975px] shrink-0 bg-current"
      style={{
        maskImage,
        maskPosition: "center",
        maskRepeat: "no-repeat",
        maskSize: "contain",
        WebkitMaskImage: maskImage,
        WebkitMaskPosition: "center",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
      }}
    />
  );
}

function isNavItemActive(key: AppNavKey, pathname: string) {
  if (key === "overview") return pathname === "/";
  if (key === "documents") return pathname === "/documents";
  if (key === "parse") return pathname === "/parse" || pathname === "/documents/parsed";
  if (key === "chunking") return pathname === "/chunking" || pathname === "/documents/chunks";
  if (key === "embeddings") return pathname === "/embeddings";
  if (key === "playground") return pathname === "/playground" || pathname === "/retrieval";
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
  const className = "flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20";

  if (href) {
    return <Link className={className} href={href} onClick={onClick}><Icon aria-hidden="true" className="size-4 text-subtle-foreground" />{label}</Link>;
  }

  return <button className={className} onClick={onClick} type="button"><Icon aria-hidden="true" className="size-4 text-subtle-foreground" />{label}</button>;
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
        className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/20"
        onClick={() => setOpenView(isOpen ? null : "menu")}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-subtle text-[11px] font-semibold text-accent-foreground">{initials}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] leading-[18.75px] text-muted-foreground">{displayName}</span>
          <span className="sr-only">{user.email ?? copy.common.frontendFoundation}</span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            aria-label={copy.common.accountMenu}
            className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-50 overflow-hidden rounded-[12px] border border-border bg-card p-1.5 shadow-lg shadow-foreground/8"
            exit={{ opacity: 0, y: 4 }}
            initial={{ opacity: 0, y: 4 }}
            role="dialog"
            transition={{ duration: 0.14, ease: "easeOut" }}
          >
            {openView === "menu" && (
              <>
                <div className="mb-1 border-b border-border px-2.5 pb-2.5 pt-1">
                  <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                  <p className="truncate text-xs text-subtle-foreground">{user.email ?? copy.common.frontendFoundation}</p>
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
                <button className="mb-2 flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={() => setOpenView("menu")} type="button">
                  <ArrowLeft aria-hidden="true" className="size-3.5" />
                  {copy.common.back}
                </button>
                <h2 className="px-1.5 text-sm font-semibold text-foreground">{copy.guidePanel.title}</h2>
                <p className="px-1.5 pt-1.5 text-xs leading-5 text-muted-foreground">{copy.guidePanel.description}</p>
                <nav aria-label={copy.guides} className="mt-3 grid gap-1 border-t pt-2 text-sm">
                  <Link className="rounded px-2 py-1.5 hover:bg-accent hover:text-accent-foreground" href="/" onClick={closeAfterNavigation}>{copy.nav.overview}</Link>
                  <Link className="rounded px-2 py-1.5 hover:bg-accent hover:text-accent-foreground" href="/documents" onClick={closeAfterNavigation}>{copy.nav.documents}</Link>
                  <Link className="rounded px-2 py-1.5 hover:bg-accent hover:text-accent-foreground" href="/playground" onClick={closeAfterNavigation}>{copy.nav.playground}</Link>
                </nav>
              </div>
            )}

            {openView === "help" && (
              <div className="p-1">
                <button className="mb-2 flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground" onClick={() => setOpenView("menu")} type="button">
                  <ArrowLeft aria-hidden="true" className="size-3.5" />
                  {copy.common.back}
                </button>
                <h2 className="px-1.5 text-sm font-semibold text-foreground">{copy.helpPanel.title}</h2>
                <p className="px-1.5 pt-1.5 text-xs leading-5 text-muted-foreground">{copy.helpPanel.description}</p>
                <Link className="mt-3 inline-flex border-t px-1.5 pt-2 text-sm font-medium text-foreground underline-offset-4 hover:text-accent-foreground hover:underline" href="/settings" onClick={closeAfterNavigation}>
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
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-[72px] items-center gap-2.5 px-5 pb-5 pt-6">
        <Image alt="" className="theme-brand-mark" height={28} priority src={UI_ASSETS.brand.mark} width={28} />
        <span className="text-[15px] font-semibold leading-[22.5px] tracking-[-0.15px] text-foreground">{copy.productName}</span>
      </div>

      <nav aria-label={copy.common.primaryNavigation} className="flex flex-1 flex-col overflow-hidden px-3 pb-4 pt-0">
        {navGroups.map((group) => (
          <div className={cn("space-y-0", group.label && "pt-6")} key={group.label ?? group.items[0].key}>
            {group.label ? <p className="px-3 text-[11px] font-semibold uppercase leading-[16.5px] tracking-[0.99px] text-subtle-foreground">{copy.nav[group.label]}</p> : null}
            <div className={cn(group.label && "pt-1.5")}>
              {group.items.map((item) => {
                const isActive = isNavItemActive(item.key, pathname);
                return (
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex h-[36.967px] items-center gap-3 rounded-[10px] px-3 py-2 text-sm leading-[21px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                      isActive && "bg-accent font-medium text-accent-foreground",
                    )}
                    href={item.href}
                    key={item.key}
                    onClick={onNavigate}
                    prefetch={false}
                  >
                    {isActive ? <item.icon aria-hidden="true" className="size-[17.975px] stroke-[1.65]" /> : navIconAssets[item.key] ? <ThemedAssetIcon src={navIconAssets[item.key] as string} /> : <item.icon aria-hidden="true" className="size-[17.975px] stroke-[1.65]" />}
                    {copy.nav[item.key]}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
        <div className="mt-auto -mx-3 border-t-[1.712px] border-border px-3 pb-1 pt-4">
          <Link
            aria-current={isNavItemActive(settingsNavItem.key, pathname) ? "page" : undefined}
            className={cn(
              "flex h-[36.967px] items-center gap-3 rounded-[10px] px-3 py-2 text-sm leading-[21px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              isNavItemActive(settingsNavItem.key, pathname) && "bg-accent font-medium text-accent-foreground",
            )}
            href={settingsNavItem.href}
            onClick={onNavigate}
            prefetch={false}
          >
            {isNavItemActive(settingsNavItem.key, pathname) ? <settingsNavItem.icon aria-hidden="true" className="size-[17.975px] stroke-[1.65]" /> : <ThemedAssetIcon src={navIconAssets.settings as string} />}
            {copy.nav.settings}
          </Link>
        </div>
      </nav>

      <div className="px-3 pb-3 pt-1" data-testid="app-shell-user"><UserMenu copy={copy} onNavigate={onNavigate} onSignOut={onSignOut} user={user} /></div>
    </div>
  );
}

function getPageTitle(pathname: string, copy: AppCopy) {
  if (pathname === "/") return copy.nav.overview;
  if (pathname === "/parse" || pathname === "/documents/parsed") return copy.nav.parse;
  if (pathname === "/chunking" || pathname === "/documents/chunks") return copy.nav.chunking;
  if (pathname === "/embeddings") return copy.nav.embeddings;
  if (pathname.startsWith("/documents")) return copy.nav.documents;
  if (pathname === "/playground" || pathname === "/retrieval") return copy.nav.playground;
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
  const { user } = useAuthBootstrap();
  const authUser = useMemo(() => getAuthUserSummary(user), [user]);

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
      <MotionConfig reducedMotion="user">
        <PageTransition>{children}</PageTransition>
      </MotionConfig>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen w-full min-w-0 bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] border-r border-border xl:block" data-testid="app-shell-sidebar">
        <Sidebar copy={copy} onSignOut={signOut} pathname={pathname} user={authUser} />
      </aside>

      <div
        aria-hidden={!mobileOpen}
        className="pointer-events-none fixed inset-0 z-50 xl:hidden"
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
              className="pointer-events-auto relative h-full w-[min(86vw,320px)] border-r border-border bg-card"
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

      <div className="w-full min-w-0 xl:pl-[248px]">
        <header className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b border-border bg-card px-4 sm:px-7 xl:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <Button aria-controls="mobile-navigation" aria-expanded={mobileOpen} aria-label={copy.common.openNavigation} className="xl:hidden" onClick={() => setMobileOpen(true)} ref={mobileOpenButtonRef} size="icon" variant="ghost">
              <Menu className="size-5" />
            </Button>
            <span className="truncate text-lg font-semibold tracking-[-0.02em]">{getPageTitle(pathname, copy)}</span>
          </div>
        </header>

        <main className="w-full min-w-0" data-testid="app-shell-main">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      </div>
    </MotionConfig>
  );
}
