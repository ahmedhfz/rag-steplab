import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve("app/globals.css"), "utf8");

function themeTokens(selector: ":root" | ":root.dark") {
  const escaped = selector.replace(".", "\\.");
  const block = css.match(new RegExp(`${escaped} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
  return Object.fromEntries(Array.from(block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi), ([, name, value]) => [name, value]));
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("theme token contrast", () => {
  it("keeps representative Light and Dark text hierarchy above 4.5:1", () => {
    for (const tokens of [themeTokens(":root"), themeTokens(":root.dark")]) {
      expect(contrast(tokens.foreground, tokens.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens["muted-foreground"], tokens.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens["subtle-foreground"], tokens.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens["accent-foreground"], tokens.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps Dark success, warning, and destructive states readable on their subtle surfaces", () => {
    const tokens = themeTokens(":root.dark");
    expect(contrast(tokens.success, tokens["success-subtle"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.warning, tokens["warning-subtle"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.destructive, tokens["destructive-subtle"])).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps secondary and tertiary text readable on cards, page and secondary surfaces in both themes", () => {
    for (const tokens of [themeTokens(":root"), themeTokens(":root.dark")]) {
      for (const surface of ["card", "background", "secondary", "popover"]) {
        for (const text of ["muted-foreground", "subtle-foreground"]) {
          expect(contrast(tokens[text], tokens[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("keeps form control borders (input, switch, checkbox, radio) at 3:1 in both themes", () => {
    for (const tokens of [themeTokens(":root"), themeTokens(":root.dark")]) {
      for (const surface of ["card", "background", "popover", "secondary"]) {
        expect(contrast(tokens.input, tokens[surface]), `input on ${surface}`).toBeGreaterThanOrEqual(3);
        expect(contrast(tokens["hover-border"], tokens[surface]), `hover-border on ${surface}`).toBeGreaterThanOrEqual(3);
      }
      // The select highlight bar uses the ring colour against the popover.
      expect(contrast(tokens.ring, tokens.popover)).toBeGreaterThanOrEqual(3);
    }
  });

  it("lightens Dark surfaces with elevation instead of carving darker wells", () => {
    const tokens = themeTokens(":root.dark");
    const ladder = ["background", "surface-subtle", "card", "technical", "popover"].map((key) => luminance(tokens[key]));
    expect(ladder).toEqual([...ladder].sort((left, right) => left - right));
  });

  it("keeps Dark secondary text readable on cards, menus and selected surfaces", () => {
    const tokens = themeTokens(":root.dark");
    for (const surface of ["card", "popover", "secondary", "accent"]) {
      for (const text of ["muted-foreground", "subtle-foreground", "brand"]) {
        expect(contrast(tokens[text], tokens[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(tokens.ring, tokens.card)).toBeGreaterThanOrEqual(3);
    expect(contrast(tokens.input, tokens.card)).toBeGreaterThanOrEqual(3);
    expect(tokens.overlay).toBe("#000000");
  });
});
