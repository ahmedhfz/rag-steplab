"use client";

import { TransitionPanel, TransitionSurface } from "@/components/ui/transitions";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuthBootstrap } from "@/components/auth-provider";
import { BrandMark } from "@/components/brand-mark";
import { usePreferences } from "@/components/preferences-provider";
import { PageTransition } from "@/components/page-transition";
import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { type AppCopy, type AppNavGroupKey, type AppNavKey, UI_COPY } from "@/lib/copy";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

type NavItem = { key: AppNavKey; href: string; icon: SemanticIconName };
type NavGroup = { label?: AppNavGroupKey; items: NavItem[] };

const navGroups: NavGroup[] = [
  { items: [{ key: "overview", href: "/", icon: "overview" }] },
  {
    label: "prepare",
    items: [
      { key: "documents", href: "/documents", icon: "document" },
      { key: "parse", href: "/parse", icon: "parse" },
      { key: "chunking", href: "/chunking", icon: "chunk" },
      { key: "embeddings", href: "/embeddings", icon: "embed" },
    ],
  },
  {
    label: "test",
    items: [{ key: "playground", href: "/playground", icon: "retrieve" }],
  },
  {
    label: "measure",
    items: [{ key: "evaluation", href: "/evaluation", icon: "evaluate" }],
  },
];

const settingsNavItem: NavItem = { key: "settings", href: "/settings", icon: "settings" };

function isNavItemActive(key: AppNavKey, pathname: string) {
  if (key === "overview") return pathname === "/";
  if (key === "documents") return pathname === "/documents";
  if (key === "parse") return pathname === "/parse" || pathname === "/documents/parsed";
  if (key === "chunking") return pathname === "/chunking" || pathname === "/documents/chunks";
  if (key === "embeddings") return pathname === "/embeddings";
  if (key === "playground") return pathname === "/playground" || pathname === "/retrieval";
  return pathname === `/${key}`;
}

/** Active item: neutral surface + brand icon, so brand marks only "where you are". */
function navItemClass(isActive: boolean) {
  return cn(
    "flex h-9 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-surface-subtle hover:text-foreground",
    isActive && "bg-secondary font-medium text-foreground hover:bg-secondary",
  );
}

function navIconClass(isActive: boolean) {
  return cn("size-4.5 shrink-0", isActive && "text-brand");
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
  icon: SemanticIconName;
  label: string;
  onClick?: () => void;
  href?: string;
};

function UserMenuItem({ icon, label, onClick, href }: UserMenuItemProps) {
  const className = "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";

  if (href) {
    return <Link className={className} href={href} onClick={onClick}><AppIcon name={icon} className="size-4 text-subtle-foreground" />{label}</Link>;
  }

  return <button className={className} onClick={onClick} type="button"><AppIcon name={icon} className="size-4 text-subtle-foreground" />{label}</button>;
}

type UserMenuProps = {
  copy: AppCopy;
  user: AuthUserSummary;
  onNavigate?: () => void;
  onSignOut: () => Promise<void>;
};

function UserMenu({ copy, user, onNavigate, onSignOut }: UserMenuProps) {
  const [openView, setOpenView] = useState<"menu" | "help">("menu");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const displayName = user.name ?? user.email ?? copy.productName;
  const initials = getInitials(user.name, user.email);

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      if (openView === "menu") {
        setIsOpen(false);
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
    setIsOpen(false);
    onNavigate?.();
  }

  async function handleSignOut() {
    setIsOpen(false);
    await onSignOut();
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`${displayName} — ${copy.common.accountMenu}`}
        className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-surface-subtle"
        onClick={() => { setIsOpen(!isOpen); setOpenView("menu"); }}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-secondary text-2xs font-semibold text-foreground">{initials}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-muted-foreground" data-testid="app-shell-user-name">{displayName}</span>
          <span className="sr-only">{user.email ?? copy.common.accountFallback}</span>
        </span>
      </button>

      <TransitionSurface kind="dropdown" open={isOpen} data-origin="bottom-left"
            aria-label={copy.common.accountMenu}
            className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-50 overflow-hidden rounded-lg border border-border bg-card p-1.5 shadow-lg shadow-foreground/8"
            role="dialog"
          >
            <TransitionPanel transitionKey={openView}>
            {openView === "menu" && (
              <>
                <div className="mb-1 border-b border-border px-2.5 pb-2.5 pt-1">
                  <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                  <p className="truncate text-xs text-subtle-foreground">{user.email ?? copy.common.accountFallback}</p>
                </div>
                <UserMenuItem icon="help" label={copy.help} onClick={() => setOpenView("help")} />
                <UserMenuItem href="/settings" icon="settings" label={copy.nav.settings} onClick={closeAfterNavigation} />
                <div className="my-1 border-t" />
                <UserMenuItem icon="logOut" label={copy.common.signOut} onClick={() => void handleSignOut()} />
              </>
            )}

            {openView === "help" && (
              <div className="p-1">
                <button className="mb-2 flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => setOpenView("menu")} type="button">
                  <AppIcon name="arrowLeft" className="size-3.5" />
                  {copy.common.back}
                </button>
                <h2 className="px-1.5 text-sm font-semibold text-foreground">{copy.helpPanel.title}</h2>
                <p className="px-1.5 pb-1 pt-1.5 text-xs leading-5 text-muted-foreground">{copy.helpPanel.description}</p>
              </div>
            )}
            </TransitionPanel>
      </TransitionSurface>
    </div>
  );
}

function Sidebar({ pathname, onNavigate, copy, user, onSignOut }: { pathname: string; onNavigate?: () => void; copy: AppCopy; user: AuthUserSummary; onSignOut: () => Promise<void> }) {
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-[72px] items-center gap-2.5 px-5 pb-5 pt-6">
        <BrandMark />
        <span className="text-base font-semibold tracking-tight text-foreground">{copy.productName}</span>
      </div>

      <nav aria-label={copy.common.primaryNavigation} className="flex flex-1 flex-col overflow-hidden px-3 pb-4 pt-0">
        {navGroups.map((group) => (
          <div className={cn("space-y-0", group.label && "pt-6")} key={group.label ?? group.items[0].key}>
            {group.label ? <p className="px-3 text-xs font-medium text-subtle-foreground">{copy.navGroups[group.label]}</p> : null}
            <div className={cn(group.label && "pt-1.5")}>
              {group.items.map((item) => {
                const isActive = isNavItemActive(item.key, pathname);
                return (
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={navItemClass(isActive)}
                    href={item.href}
                    key={item.key}
                    onClick={onNavigate}
                    prefetch={false}
                  >
                    <AppIcon name={item.icon} className={navIconClass(isActive)} />
                    {copy.nav[item.key]}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
        <div className="mt-auto -mx-3 border-t border-border px-3 pb-1 pt-4">
          <Link
            aria-current={isNavItemActive(settingsNavItem.key, pathname) ? "page" : undefined}
            className={navItemClass(isNavItemActive(settingsNavItem.key, pathname))}
            href={settingsNavItem.href}
            onClick={onNavigate}
            prefetch={false}
          >
            <AppIcon name={settingsNavItem.icon} className={navIconClass(isNavItemActive(settingsNavItem.key, pathname))} />
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
    return <PageTransition>{children}</PageTransition>;
  }

  return (
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
        <TransitionSurface className="steplab-backdrop absolute inset-0" kind="modal" open={mobileOpen}>
          <button aria-label={copy.common.close} className="absolute inset-0 bg-overlay/20" onClick={() => setMobileOpen(false)} tabIndex={-1} type="button" />
        </TransitionSurface>
        <TransitionSurface as="aside" aria-label={copy.common.primaryNavigation} aria-modal="true" className="relative h-full w-[min(86vw,320px)] border-r border-border bg-card" kind="panel" open={mobileOpen} role="dialog" surfaceRef={mobilePanelRef}>
          <Button aria-label={copy.common.close} autoFocus className="absolute right-3 top-4 z-10" onClick={() => setMobileOpen(false)} ref={mobileCloseButtonRef} size="icon" variant="ghost"><AppIcon name="close" className="size-5" /></Button>
          <Sidebar copy={copy} onNavigate={() => setMobileOpen(false)} onSignOut={signOut} pathname={pathname} user={authUser} />
        </TransitionSurface>
      </div>

      <div className="w-full min-w-0 xl:pl-[248px]">
        <header className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b border-border bg-card px-4 sm:px-7 xl:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <Button aria-controls="mobile-navigation" aria-expanded={mobileOpen} aria-label={copy.common.openNavigation} className="xl:hidden" onClick={() => setMobileOpen(true)} ref={mobileOpenButtonRef} size="icon" variant="ghost">
              <AppIcon name="menu" className="size-5" />
            </Button>
            <span className="truncate text-lg font-semibold tracking-tight">{getPageTitle(pathname, copy)}</span>
          </div>
        </header>

        <main className="w-full min-w-0" data-testid="app-shell-main">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      </div>
  );
}

