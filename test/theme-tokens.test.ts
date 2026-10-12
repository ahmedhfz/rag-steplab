import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve("app/globals.css"), "utf8");
// Legacy tokens alias steps of the Untitled-format scales in app/theme.css; resolve var() chains to hex.
const themeCss = readFileSync(path.resolve("app/theme.css"), "utf8");

type Mode = ":root" | ":root.dark";

function block(source: string, selector: Mode) {
  const escaped = selector.replace(".", "\\.");
  return source.match(new RegExp(`^${escaped} \\{([\\s\\S]*?)\\n\\}`, "m"))?.[1] ?? "";
}

function declarations(source: string) {
  return Object.fromEntries(Array.from(source.matchAll(/--([\w-]+):\s*([^;]+);/g), ([, name, value]) => [name, value.trim()]));
}

function themeEnvironment(mode: Mode) {
  const darkBlock = block(themeCss, ":root.dark");
  const base = declarations(themeCss.replace(darkBlock, ""));
  return mode === ":root.dark" ? { ...base, ...declarations(darkBlock) } : base;
}

function resolve(value: string | undefined, env: Record<string, string>): string | undefined {
  let current = value;
  for (let depth = 0; current && depth < 10; depth += 1) {
    const reference = current.match(/^var\(--([\w-]+)\)$/);
    if (!reference) break;
    current = env[reference[1]];
  }
  return current && /^#[0-9a-f]{6}$/i.test(current) ? current : undefined;
}

function themeTokens(selector: Mode) {
  const legacy = declarations(block(css, selector));
  const env = { ...themeEnvironment(selector), ...legacy };
  return Object.fromEntries(Object.keys(legacy).map((name) => [name, resolve(legacy[name], env)]).filter(([, value]) => value)) as Record<string, string>;
}

function semanticTokens(mode: Mode) {
  const env = themeEnvironment(mode);
  return (name: string) => {
    const value = resolve(env[name], env);
    if (!value) throw new Error(`--${name} does not resolve to a hex colour in ${mode}`);
    return value;
  };
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

describe("Untitled semantic tokens (app/theme.css)", () => {
  const modes: Mode[] = [":root", ":root.dark"];

  it("keeps primary, secondary, tertiary and quaternary text readable on every content surface", () => {
    for (const mode of modes) {
      const token = semanticTokens(mode);
      for (const surface of ["bg-canvas", "bg-primary", "bg-primary_alt", "bg-secondary"]) {
        for (const text of ["text-primary", "text-secondary", "text-tertiary", "text-quaternary", "text-brand-secondary"]) {
          expect(contrast(token(`color-${text}`), token(`color-${surface}`)), `${mode} ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("keeps status text readable on its own tinted surface and on panels", () => {
    for (const mode of modes) {
      const token = semanticTokens(mode);
      for (const status of ["error", "warning", "success"]) {
        expect(contrast(token(`color-text-${status}-primary`), token(`color-bg-${status}-primary`)), `${mode} ${status}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(token(`color-text-${status}-primary`), token("color-bg-primary")), `${mode} ${status} on panel`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps white labels readable on solid fills, and the focus ring and control borders at 3:1", () => {
    for (const mode of modes) {
      const token = semanticTokens(mode);
      for (const fill of ["bg-brand-solid", "bg-brand-solid_hover", "bg-error-solid", "bg-primary-solid"]) {
        expect(contrast("#ffffff", token(`color-${fill}`)), `${mode} white on ${fill}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const surface of ["bg-canvas", "bg-primary", "bg-secondary"]) {
        expect(contrast(token("color-focus-ring"), token(`color-${surface}`)), `${mode} focus ring on ${surface}`).toBeGreaterThanOrEqual(3);
        expect(contrast(token("color-border-control"), token(`color-${surface}`)), `${mode} control border on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("raises Dark surfaces with elevation: canvas < panel < raised", () => {
    const token = semanticTokens(":root.dark");
    const ladder = ["bg-canvas", "bg-primary", "bg-secondary"].map((name) => luminance(token(`color-${name}`)));
    expect(ladder[0]).toBeLessThan(ladder[1]);
    expect(ladder[1]).toBeLessThan(ladder[2]);
  });
});
