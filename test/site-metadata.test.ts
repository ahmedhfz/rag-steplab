// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// next/font is a compiler transform; the metadata under test does not depend on it.
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist-sans" }),
  Geist_Mono: () => ({ variable: "font-geist-mono" }),
}));

async function loadMetadata() {
  vi.resetModules();
  return (await import("@/app/layout")).metadata;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("root metadata", () => {
  it("describes link previews with an absolute base and a large card", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const metadata = await loadMetadata();

    expect(String(metadata.metadataBase)).toBe("https://rag-steplab.vercel.app/");
    expect(metadata.title).toBe("RAG StepLab");
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      siteName: "RAG StepLab",
      title: "RAG StepLab",
      description: metadata.description,
      locale: "en_US",
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("uses a configured site URL and ignores an invalid one", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", " https://preview.example.dev ");
    expect(String((await loadMetadata()).metadataBase)).toBe("https://preview.example.dev/");

    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not a url");
    expect(String((await loadMetadata()).metadataBase)).toBe("https://rag-steplab.vercel.app/");
  });
});

describe("generated share images", () => {
  it("renders the Open Graph image as a 1200x630 PNG without network access", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const og = await import("@/app/opengraph-image");
    const response = og.default();
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(og.size).toEqual({ width: 1200, height: 630 });
    expect(og.alt).toMatch(/RAG StepLab/);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Array.from(bytes.slice(1, 4), (byte) => String.fromCharCode(byte)).join("")).toBe("PNG");
    expect(new DataView(bytes.buffer).getUint32(16)).toBe(1200);
    expect(new DataView(bytes.buffer).getUint32(20)).toBe(630);
    // next/og loads its wasm from inline data: URLs; anything else would be a network request.
    const requested = fetchSpy.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input));
    expect(requested.filter((url) => !url.startsWith("data:"))).toEqual([]);
  });

  it("renders the Apple touch icon from the same mark", async () => {
    const icon = await import("@/app/apple-icon");
    const bytes = new Uint8Array(await icon.default().arrayBuffer());

    expect(new DataView(bytes.buffer).getUint32(16)).toBe(180);
    expect(new DataView(bytes.buffer).getUint32(20)).toBe(180);
  });
});
