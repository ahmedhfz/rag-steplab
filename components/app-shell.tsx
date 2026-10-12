"use client";

import { TransitionPanel, TransitionSurface } from "@/components/ui/transitions";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type Ref, useEffect, useId, useMemo, useRef, useState } from "react";

import { useAuthBootstrap } from "@/components/auth-provider";
import { BrandMark } from "@/components/brand-mark";
import { useOptionalDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { PageTransition } from "@/components/page-transition";
import { AppIcon, type SemanticIconName } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { type AppCopy, type AppNavGroupKey, type AppNavKey, UI_COPY } from "@/lib/copy";
import { documentTitle, pageTitle, pageTitleKey } from "@/lib/page-titles";
import type { PipelineStepState } from "@/lib/rag-ui-types";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import { buildWorkspaceOverview } from "@/lib/workspace-overview";

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

type StageStates = Partial<Record<AppNavKey, PipelineStepState>>;

/** Playground covers retrieval → answer: an exception anywhere wins, then "next", then done. */
function playgroundState(states: PipelineStepState[]): PipelineStepState {
  for (const exception of ["Processing", "Error", "Stale"] as const) if (states.includes(exception)) return exception;
  if (states.includes("Ready")) return "Ready";
  return states.every((state) => state === "Completed" || state === "Skipped") ? "Completed" : "Locked";
}

/**
 * Stage markers for the selected document + pipeline lineage, from the same derivation as the
 * Overview journey. Read optionally: the shell also renders without the pipeline provider.
 */
function useNavStageStates(): StageStates | null {
  const pipeline = useOptionalDocumentPipeline();
  return useMemo(() => {
    if (!pipeline || pipeline.persistenceStatus !== "available") return null;
    const state = buildWorkspaceOverview(pipeline).pipelineState;
    return {
      documents: state.document,
      parse: state.parse,
      chunking: state.chunk,
      embeddings: state.embed,
      playground: playgroundState([state.retrieve, state.rerank, state.context, state.generate]),
      evaluation: state.evaluate,
    };
  }, [pipeline]);
}

/** Quiet trailing marker: done = grey check, next = brand dot, exceptions in their colour; locked shows nothing. */
function NavStageMarker({ state }: { state: PipelineStepState | undefined }) {
  if (!state || state === "Locked" || state === "Not started") return null;
  if (state === "Processing") return <Spinner aria-hidden="true" className="shrink-0" size="xs" />;
  if (state === "Completed" || state === "Skipped") {
    return <AppIcon aria-hidden="true" className="size-3.5 shrink-0 text-fg-quaternary" data-stage-state={state} name="check" strokeWidth={2} />;
  }
  if (state === "Ready") {
    return (
      <span aria-hidden="true" className="relative grid size-4 shrink-0 place-items-center" data-stage-state={state}>
        <span className="absolute inset-0.5 rounded-full bg-brand-primary" />
        <span className="relative size-1.5 rounded-full bg-fg-brand-primary" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center" data-stage-state={state}>
      <span className={cn("size-1.5 rounded-full", state === "Error" ? "bg-fg-error-secondary" : "bg-fg-warning-secondary")} />
    </span>
  );
}

function NavLink({ item, pathname, copy, state, onNavigate }: { item: NavItem; pathname: string; copy: AppCopy; state?: PipelineStepState; onNavigate?: () => void }) {
  const isActive = isNavItemActive(item.key, pathname);
  // The stage state is a description, never part of the link's name.
  const description = state && state !== "Locked" && state !== "Not started" ? copy.status[state] : undefined;
  return (
    <Link
      aria-current={isActive ? "page" : undefined}
      aria-description={description}
      className={cn(
        "group/nav flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-secondary transition-colors duration-150",
        "hover:bg-primary_hover hover:text-primary",
        isActive && "bg-active font-semibold text-primary hover:bg-active",
      )}
      href={item.href}
      onClick={onNavigate}
      prefetch={false}
    >
      <AppIcon
        className={cn(
          "size-5 shrink-0 transition-colors duration-150",
          isActive ? "text-fg-brand-primary" : "text-fg-quaternary group-hover/nav:text-fg-quaternary_hover",
        )}
        name={item.icon}
      />
      <span className="min-w-0 flex-1 truncate">{copy.nav[item.key]}</span>
      <NavStageMarker state={state} />
    </Link>
  );
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
  ref?: Ref<HTMLButtonElement>;
};

const menuItemClass = "group/item flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm font-medium text-secondary transition-colors duration-100 hover:bg-primary_hover hover:text-primary";
const menuIconClass = "size-4 shrink-0 text-fg-quaternary transition-colors group-hover/item:text-fg-quaternary_hover";

function UserMenuItem({ icon, label, onClick, href, ref }: UserMenuItemProps) {
  if (href) {
    return <Link className={menuItemClass} href={href} onClick={onClick}><AppIcon name={icon} className={menuIconClass} />{label}</Link>;
  }

  return <button className={menuItemClass} onClick={onClick} ref={ref} type="button"><AppIcon name={icon} className={menuIconClass} />{label}</button>;
}

type UserMenuProps = {
  copy: AppCopy;
  user: AuthUserSummary;
  onNavigate?: () => void;
  onSignOut: () => Promise<void>;
};

type UserMenuView = "menu" | "help";

/** Disclosure (not a dialog): the trigger keeps focus on open and Tab enters the panel. */
function UserMenu({ copy, user, onNavigate, onSignOut }: UserMenuProps) {
  const [openView, setOpenView] = useState<UserMenuView>("menu");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const helpRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  // A view switch unmounts the focused control; focus follows to its counterpart.
  const focusAfterViewChange = useRef(false);
  const panelId = useId();
  const displayName = user.name ?? user.email ?? copy.productName;
  // The second line never repeats the first (no name → the email is already the title).
  const secondaryLine = user.name && user.email ? user.email : copy.common.accountFallback;
  const initials = getInitials(user.name, user.email);

  function switchView(view: UserMenuView) {
    focusAfterViewChange.current = true;
    setOpenView(view);
  }

  useEffect(() => {
    if (!focusAfterViewChange.current) return;
    focusAfterViewChange.current = false;
    (openView === "help" ? backRef : helpRef).current?.focus();
  }, [openView]);

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
        focusAfterViewChange.current = true;
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
        aria-controls={isOpen ? panelId : undefined}
        aria-expanded={isOpen}
        aria-label={`${displayName} — ${copy.common.accountMenu}`}
        className="group/account flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors duration-150 hover:bg-primary_hover aria-expanded:bg-active"
        onClick={() => { setIsOpen(!isOpen); setOpenView("menu"); }}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-tertiary text-xs font-semibold text-secondary ring-1 ring-secondary_alt ring-inset">{initials}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-primary" data-testid="app-shell-user-name">{displayName}</span>
          <span className="block truncate text-xs text-tertiary">{secondaryLine}</span>
        </span>
        <AppIcon aria-hidden="true" className="size-4 shrink-0 text-fg-quaternary transition-transform duration-200 group-aria-expanded/account:rotate-180" name="chevronUp" />
      </button>

      <TransitionSurface kind="dropdown" open={isOpen} data-origin="bottom-left"
        aria-label={copy.common.accountMenu}
        className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl bg-primary_alt p-1.5 shadow-lg ring-1 ring-secondary_alt"
        id={panelId}
        role="group"
      >
        <TransitionPanel transitionKey={openView}>
          {openView === "menu" && (
            <>
              <UserMenuItem icon="help" label={copy.help} onClick={() => switchView("help")} ref={helpRef} />
              <UserMenuItem href="/settings" icon="settings" label={copy.nav.settings} onClick={closeAfterNavigation} />
              <div aria-hidden="true" className="-mx-1.5 my-1.5 h-px bg-border-secondary" />
              <UserMenuItem icon="logOut" label={copy.common.signOut} onClick={() => void handleSignOut()} />
            </>
          )}

          {openView === "help" && (
            <div className="p-1.5">
              <button className="-ml-1 mb-3 inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs font-semibold text-tertiary transition-colors hover:bg-primary_hover hover:text-secondary" onClick={() => switchView("menu")} ref={backRef} type="button">
                <AppIcon name="arrowLeft" className="size-3.5" />
                {copy.common.back}
              </button>
              <h2 className="text-sm font-semibold text-primary">{copy.helpPanel.title}</h2>
              <p className="mt-1 text-sm text-tertiary">{copy.helpPanel.description}</p>
            </div>
          )}
        </TransitionPanel>
      </TransitionSurface>
    </div>
  );
}

function Sidebar({ pathname, onNavigate, copy, user, onSignOut }: { pathname: string; onNavigate?: () => void; copy: AppCopy; user: AuthUserSummary; onSignOut: () => Promise<void> }) {
  const stageStates = useNavStageStates();
  return (
    <div className="flex h-full flex-col bg-primary">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
        <BrandMark />
        <span className="text-md font-semibold text-primary">{copy.productName}</span>
      </div>

      <nav aria-label={copy.common.primaryNavigation} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-2 pb-3">
        {navGroups.map((group) => (
          <div className={cn(group.label && "mt-6")} key={group.label ?? group.items[0].key}>
            {group.label ? <p className="mb-1.5 px-2.5 text-xs font-medium text-quaternary">{copy.navGroups[group.label]}</p> : null}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.key}>
                  <NavLink copy={copy} item={item} onNavigate={onNavigate} pathname={pathname} state={stageStates?.[item.key]} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="mt-auto pt-6">
          <NavLink copy={copy} item={settingsNavItem} onNavigate={onNavigate} pathname={pathname} />
        </div>
      </nav>

      <div className="border-t border-secondary p-3" data-testid="app-shell-user"><UserMenu copy={copy} onNavigate={onNavigate} onSignOut={onSignOut} user={user} /></div>
    </div>
  );
}

function getPageTitle(pathname: string, copy: AppCopy) {
  const key = pageTitleKey(pathname);
  return key ? pageTitle(copy, key) : copy.productName;
}

/**
 * Route metadata is English (the server does not know the stored locale). After
 * hydration the tab title follows the interface locale; route metadata can be
 * streamed in after navigation, so a rewritten <title> is localized again.
 */
function useLocalizedDocumentTitle(pathname: string, copy: AppCopy, isHydrated: boolean) {
  useEffect(() => {
    if (!isHydrated) return;
    const title = documentTitle(copy, pathname);
    if (!title) return;

    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { characterData: true, childList: true, subtree: true });
    return () => observer.disconnect();
  }, [copy, isHydrated, pathname]);
}

const XL_MEDIA_QUERY = "(min-width: 1280px)";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileOpenButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const mobilePanelRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const previousPathname = useRef(pathname);
  const { isHydrated, preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const router = useRouter();
  const { user } = useAuthBootstrap();
  const authUser = useMemo(() => getAuthUserSummary(user), [user]);

  useLocalizedDocumentTitle(pathname, copy, isHydrated);

  // Client navigation keeps focus on the clicked link, which may no longer exist;
  // move it to the new page instead. A full load already starts at the document top.
  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

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

    // The drawer is hidden at xl; never leave the (inert) page behind it there.
    let desktop: MediaQueryList | null = null;
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileOpen(false);
    };
    try {
      desktop = window.matchMedia(XL_MEDIA_QUERY);
      desktop.addEventListener("change", closeOnDesktop);
    } catch {
      // matchMedia olmayan ortamlarda drawer yalnız açık kapatma ile kapanır.
    }

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      desktop?.removeEventListener("change", closeOnDesktop);
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
    <div className="min-h-screen w-full min-w-0 bg-canvas text-primary">
      <a
        // Parked above the viewport rather than sr-only: sr-only plus padding leaves a clipped 24px box.
        className="fixed top-3 left-3 z-60 -translate-y-[calc(100%+1rem)] rounded-lg bg-primary_alt px-3 py-2 text-sm font-semibold text-primary shadow-lg ring-1 ring-secondary_alt focus:translate-y-0"
        data-testid="skip-to-content"
        href="#main-content"
        // Focus <main> directly: no hash entry in the router history.
        onClick={(event) => { event.preventDefault(); mainRef.current?.focus(); }}
      >
        {copy.common.skipToContent}
      </a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-62 border-r border-secondary xl:block" data-testid="app-shell-sidebar" inert={mobileOpen}>
        <Sidebar copy={copy} onSignOut={signOut} pathname={pathname} user={authUser} />
      </aside>

      <div
        className="pointer-events-none fixed inset-0 z-50 xl:hidden"
        id="mobile-navigation"
        inert={!mobileOpen}
        onKeyDown={trapMobileFocus}
      >
        <TransitionSurface className="steplab-backdrop absolute inset-0" kind="modal" open={mobileOpen}>
          <button aria-label={copy.common.close} className="absolute inset-0 bg-overlay/40 backdrop-blur-xs dark:bg-overlay/70" onClick={() => setMobileOpen(false)} tabIndex={-1} type="button" />
        </TransitionSurface>
        <TransitionSurface as="aside" aria-label={copy.common.primaryNavigation} aria-modal="true" className="relative h-full w-full max-w-80 border-r border-secondary bg-primary shadow-xl" kind="panel" open={mobileOpen} role="dialog" surfaceRef={mobilePanelRef}>
          <Button aria-label={copy.common.close} autoFocus className="absolute top-3.5 right-3 z-10" onClick={() => setMobileOpen(false)} ref={mobileCloseButtonRef} size="icon" variant="tertiary"><AppIcon name="close" className="size-5" /></Button>
          <Sidebar copy={copy} onNavigate={() => setMobileOpen(false)} onSignOut={signOut} pathname={pathname} user={authUser} />
        </TransitionSurface>
      </div>

      {/* The open drawer is modal: the page behind it leaves the tab order and the accessibility tree. */}
      <div className="w-full min-w-0 xl:pl-62" inert={mobileOpen}>
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-secondary bg-primary px-3 sm:px-5 xl:hidden">
          <Button aria-controls="mobile-navigation" aria-expanded={mobileOpen} aria-label={copy.common.openNavigation} className="xl:hidden" onClick={() => setMobileOpen(true)} ref={mobileOpenButtonRef} size="icon" variant="tertiary">
            <AppIcon name="menu" className="size-5" />
          </Button>
          <span className="min-w-0 truncate text-md font-semibold text-primary">{getPageTitle(pathname, copy)}</span>
        </header>

        <main className="w-full min-w-0 outline-none" data-testid="app-shell-main" id="main-content" ref={mainRef} tabIndex={-1}>
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
