import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render } from "@testing-library/react";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it } from "vitest";

import { BrandMark } from "@/components/brand-mark";

afterEach(() => cleanup());

function readPng(relativePath: string) {
  return PNG.sync.read(readFileSync(path.join(process.cwd(), relativePath)));
}

function cornerAlpha(png: PNG) {
  const at = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3];
  return [at(0, 0), at(png.width - 1, 0), at(0, png.height - 1), at(png.width - 1, png.height - 1)];
}

describe("BrandMark", () => {
  it("renders a decorative image of the product mark", () => {
    const { container } = render(<BrandMark />);
    const image = container.querySelector("img[data-slot='brand-mark']");

    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(image).toHaveClass("size-7");
  });

  it("lets callers resize it", () => {
    const { container } = render(<BrandMark className="size-5" />);
    expect(container.querySelector("img")).toHaveClass("size-5");
    expect(container.querySelector("img")).not.toHaveClass("size-7");
  });

  it("ships transparent favicons and an opaque Apple tile from the same mark", () => {
    const source = readPng("components/brand/rag-steplab-mark.png");
    const favicon = readPng("app/icon1.png");
    const largeIcon = readPng("app/icon2.png");
    const appleIcon = readPng("app/apple-icon.png");

    expect([source.width, source.height]).toEqual([256, 256]);
    expect([favicon.width, favicon.height]).toEqual([32, 32]);
    expect([largeIcon.width, largeIcon.height]).toEqual([192, 192]);
    expect([appleIcon.width, appleIcon.height]).toEqual([180, 180]);
    // Browser tabs show the mark on their own surface; iOS fills transparency with black, so its tile is opaque.
    for (const png of [source, favicon, largeIcon]) expect(cornerAlpha(png)).toEqual([0, 0, 0, 0]);
    expect(cornerAlpha(appleIcon)).toEqual([255, 255, 255, 255]);
  });
});
