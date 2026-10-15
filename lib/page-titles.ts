import type { Metadata } from "next";

import { type AppCopy, type AppNavKey, UI_COPY } from "@/lib/copy";

/** Page name = sidebar name; routes outside the sidebar use `documentTitles`. */
export type PageTitleKey = AppNavKey | keyof AppCopy["documentTitles"];

/** Shared by the root layout's `title.template` and the client-side locale title. */
export const TITLE_TEMPLATE = `%s · ${UI_COPY.en.productName}`;

export function pageTitle(copy: AppCopy, key: PageTitleKey): string {
  return key === "signIn" ? copy.documentTitles[key] : copy.nav[key];
}

/**
 * Route metadata is rendered on the server before the stored locale is known, so
 * it uses the English names; the shell swaps in the active locale after hydration.
 */
export function pageMetadata(key: PageTitleKey): Metadata {
  return { title: pageTitle(UI_COPY.en, key) };
}

export function pageTitleKey(pathname: string): PageTitleKey | null {
  if (pathname === "/") return "overview";
  if (pathname === "/parse" || pathname === "/documents/parsed") return "parse";
  if (pathname === "/chunking" || pathname === "/documents/chunks") return "chunking";
  if (pathname === "/embeddings") return "embeddings";
  if (pathname.startsWith("/documents")) return "documents";
  if (pathname === "/playground" || pathname === "/retrieval") return "playground";
  if (pathname === "/evaluation") return "evaluation";
  if (pathname === "/settings") return "settings";
  if (pathname === "/login") return "signIn";
  return null;
}

/** `null` leaves unknown routes (e.g. not-found) to their own metadata. */
export function documentTitle(copy: AppCopy, pathname: string): string | null {
  const key = pageTitleKey(pathname);
  return key ? TITLE_TEMPLATE.replace("%s", pageTitle(copy, key)) : null;
}
