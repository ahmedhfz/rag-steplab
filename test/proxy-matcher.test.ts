// @vitest-environment node
// Kept in its own file: Next's testing helper loads server internals that leak into route handler tests.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/proxy", () => ({ updateSupabaseSession: vi.fn(), redirectWithSessionCookies: vi.fn() }));

import { config } from "@/proxy";

describe("proxy matcher", () => {
  it("skips static assets and metadata images", () => {
    for (const url of [
      "https://app.example/opengraph-image?4f1c",
      "https://app.example/apple-icon?9a2b",
      "https://app.example/icon1.png?7c3d",
      "https://app.example/apple-icon.png?5e8f",
      "https://app.example/favicon.ico",
      "https://app.example/_next/static/chunks/app.js",
    ]) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(false);
    }
  });

  it("still runs on pages and on lookalike paths", () => {
    for (const url of [
      "https://app.example/",
      "https://app.example/playground",
      "https://app.example/opengraph-image-admin",
      "https://app.example/apple-icons",
    ]) {
      expect(unstable_doesMiddlewareMatch({ config, url }), url).toBe(true);
    }
  });
});
