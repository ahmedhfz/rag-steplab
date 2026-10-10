import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BrandMark } from "@/components/brand-mark";

afterEach(() => cleanup());

describe("BrandMark", () => {
  it("renders a decorative inline mark colored by the brand token", () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector("svg[data-slot='brand-mark']");

    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveClass("text-brand", "size-7");
    expect(container.querySelector("img")).toBeNull();
    for (const shape of container.querySelectorAll("path")) expect(shape).toHaveAttribute("stroke", "currentColor");
    for (const bubble of container.querySelectorAll("circle")) expect(bubble).toHaveAttribute("fill", "currentColor");
  });

  it("lets callers resize it without losing the brand color", () => {
    const { container } = render(<BrandMark className="size-5" />);
    expect(container.querySelector("svg")).toHaveClass("size-5", "text-brand");
    expect(container.querySelector("svg")).not.toHaveClass("size-7");
  });

  it("keeps the favicon on the same flask geometry", () => {
    const { container } = render(<BrandMark />);
    const favicon = readFileSync(path.join(process.cwd(), "app/icon.svg"), "utf8");

    for (const shape of container.querySelectorAll("path")) expect(favicon).toContain(`d="${shape.getAttribute("d")}"`);
    expect(favicon).toContain("#711F3A");
  });
});
