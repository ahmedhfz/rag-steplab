"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Beaker,
  BookOpen,
  CircleHelp,
  FileText,
  Grid2X2,
  Home,
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

function Sidebar({ pathname, onNavigate, copy }: { pathname: string; onNavigate?: () => void; copy: AppCopy }) {
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

      <div className="flex items-center gap-3 border-t px-5 py-4">
        <span className="grid size-9 place-items-center rounded-full bg-slate-100 text-xs font-semibold">RL</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{copy.common.frontendFoundation}</div>
          <div className="text-xs text-slate-500">{copy.footer.backendStatus}</div>
        </div>
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

type HeaderMenuKey = "guides" | "help";

type HeaderMenuProps = {
  id: HeaderMenuKey;
  label: string;
  icon: LucideIcon;
  panelTitle: string;
  panelDescription: string;
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  showLabelOnSmallScreens?: boolean;
};

function HeaderMenu({
  id,
  label,
  icon: Icon,
  panelTitle,
  panelDescription,
  children,
  open,
  onOpenChange,
  className,
  showLabelOnSmallScreens = true,
}: HeaderMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = `${id}-header-panel`;
  const titleId = `${id}-header-panel-title`;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) onOpenChange(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      onOpenChange(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown") return;

    event.preventDefault();
    onOpenChange(true);
    requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>("a, button")?.focus());
  }

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className={cn(
          "flex h-8 items-center gap-2 rounded-md px-3 text-sm text-slate-700 outline-none transition-colors hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-slate-400",
          !showLabelOnSmallScreens && "px-2 sm:px-3",
        )}
        onClick={() => onOpenChange(!open)}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        <Icon aria-hidden="true" className="size-4" />
        <span className={cn(!showLabelOnSmallScreens && "hidden sm:inline")}>{label}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            aria-labelledby={titleId}
            className="absolute right-0 top-10 z-50 w-72 origin-top-right border bg-white p-4 shadow-sm"
            exit={{ opacity: 0, y: -4 }}
            id={panelId}
            initial={{ opacity: 0, y: -4 }}
            ref={panelRef}
            role="dialog"
            transition={{ duration: 0.14, ease: "easeOut" }}
          >
            <h2 className="text-sm font-semibold" id={titleId}>{panelTitle}</h2>
            <p className="mt-2 text-xs leading-5 text-slate-600">{panelDescription}</p>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HeaderMenus({ copy }: { copy: AppCopy }) {
  const [openMenu, setOpenMenu] = useState<HeaderMenuKey | null>(null);

  return (
    <div className="flex items-center gap-1 sm:gap-4">
      <HeaderMenu
        className="hidden sm:block"
        icon={BookOpen}
        id="guides"
        label={copy.guides}
        onOpenChange={(open) => setOpenMenu(open ? "guides" : null)}
        open={openMenu === "guides"}
        panelDescription={copy.guidePanel.description}
        panelTitle={copy.guidePanel.title}
      >
        <nav aria-label={copy.guides} className="mt-3 grid gap-1 border-t pt-3 text-sm">
          <Link className="rounded px-2 py-1.5 hover:bg-slate-100" href="/" onClick={() => setOpenMenu(null)}>{copy.nav.overview}</Link>
          <Link className="rounded px-2 py-1.5 hover:bg-slate-100" href="/documents" onClick={() => setOpenMenu(null)}>{copy.nav.documents}</Link>
          <Link className="rounded px-2 py-1.5 hover:bg-slate-100" href="/retrieval" onClick={() => setOpenMenu(null)}>{copy.nav.retrieval}</Link>
        </nav>
      </HeaderMenu>

      <HeaderMenu
        icon={CircleHelp}
        id="help"
        label={copy.help}
        onOpenChange={(open) => setOpenMenu(open ? "help" : null)}
        open={openMenu === "help"}
        panelDescription={copy.helpPanel.description}
        panelTitle={copy.helpPanel.title}
        showLabelOnSmallScreens={false}
      >
        <Link className="mt-3 inline-flex border-t pt-3 text-sm font-medium text-slate-900 underline-offset-4 hover:underline" href="/settings" onClick={() => setOpenMenu(null)}>
          {copy.helpPanel.settingsLink}
        </Link>
      </HeaderMenu>

      <Button asChild aria-label={copy.nav.settings} className="text-slate-700" size="icon" variant="ghost">
        <Link href="/settings">
          <Settings aria-hidden="true" className="size-[18px]" />
        </Link>
      </Button>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileOpenButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const mobilePanelRef = useRef<HTMLElement>(null);
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
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

  return (
    <MotionConfig reducedMotion="never">
      <div className="min-h-screen bg-[#fdfdfd] text-slate-950">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] border-r lg:block">
        <Sidebar copy={copy} pathname={pathname} />
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
              <Sidebar copy={copy} onNavigate={() => setMobileOpen(false)} pathname={pathname} />
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
          <HeaderMenus copy={copy} />
        </header>

        <main className="min-w-0">
          <PageTransition pathname={pathname}>{children}</PageTransition>
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
