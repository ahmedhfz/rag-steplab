import { describe, expect, it } from "vitest";

import { UI_COPY } from "@/lib/copy";
import { documentTitle, pageTitleKey } from "@/lib/page-titles";

// Each route's server metadata names the page like the sidebar (English: the
// server cannot know the stored locale); the shell localizes it on the client.
const routes = [
  ["@/app/page", "/", "Overview"],
  ["@/app/documents/page", "/documents", "Documents"],
  ["@/app/parse/page", "/parse", "Parsing"],
  ["@/app/chunking/page", "/chunking", "Chunking"],
  ["@/app/embeddings/page", "/embeddings", "Embeddings"],
  ["@/app/playground/page", "/playground", "Playground"],
  ["@/app/evaluation/page", "/evaluation", "Evaluation"],
  ["@/app/settings/page", "/settings", "Settings"],
  ["@/app/login/page", "/login", "Sign in"],
  ["@/app/auth/reset-password/page", "/auth/reset-password", "Reset password"],
] as const;

const pageModules: Record<string, () => Promise<{ metadata?: { title?: unknown } }>> = {
  "@/app/page": () => import("@/app/page"),
  "@/app/documents/page": () => import("@/app/documents/page"),
  "@/app/parse/page": () => import("@/app/parse/page"),
  "@/app/chunking/page": () => import("@/app/chunking/page"),
  "@/app/embeddings/page": () => import("@/app/embeddings/page"),
  "@/app/playground/page": () => import("@/app/playground/page"),
  "@/app/evaluation/page": () => import("@/app/evaluation/page"),
  "@/app/settings/page": () => import("@/app/settings/page"),
  "@/app/login/page": () => import("@/app/login/page"),
  "@/app/auth/reset-password/page": () => import("@/app/auth/reset-password/page"),
};

describe("page titles", () => {
  it.each(routes)("%s names its route for the title template", async (module, pathname, title) => {
    const page = await pageModules[module]();
    expect(page.metadata?.title).toBe(title);
    expect(documentTitle(UI_COPY.en, pathname)).toBe(`${title} · RAG StepLab`);
  });

  it("uses the sidebar names of the active locale on the client", () => {
    expect(documentTitle(UI_COPY.tr, "/parse")).toBe("Ayrıştırma · RAG StepLab");
    expect(documentTitle(UI_COPY.tr, "/playground")).toBe("Deney Alanı · RAG StepLab");
    expect(documentTitle(UI_COPY.tr, "/login")).toBe("Giriş yap · RAG StepLab");
  });

  it("maps legacy routes to their current page and leaves unknown routes alone", () => {
    expect(pageTitleKey("/documents/parsed")).toBe("parse");
    expect(pageTitleKey("/documents/chunks")).toBe("chunking");
    expect(pageTitleKey("/retrieval")).toBe("playground");
    expect(documentTitle(UI_COPY.en, "/does-not-exist")).toBeNull();
  });
});
