import { describe, expect, it } from "vitest";

import { formatCount, formatMs, formatNumber, formatScore } from "@/lib/format";

describe("locale-aware number formatting", () => {
  it("groups numbers per locale", () => {
    expect(formatNumber("en", 12345)).toBe("12,345");
    expect(formatNumber("tr", 12345)).toBe("12.345");
    expect(formatNumber("en", 0.5, { maximumFractionDigits: 1 })).toBe("0.5");
    expect(formatNumber("tr", 0.5, { maximumFractionDigits: 1 })).toBe("0,5");
    expect(formatNumber("en", null)).toBe("—");
    expect(formatNumber("en", Number.NaN)).toBe("—");
  });

  it("inflects English units and keeps Turkish units uninflected after a number", () => {
    const chunks = { one: "chunk", other: "chunks" };
    expect(formatCount("en", 1, chunks)).toBe("1 chunk");
    expect(formatCount("en", 0, chunks)).toBe("0 chunks");
    expect(formatCount("en", 2, chunks)).toBe("2 chunks");
    expect(formatCount("en", 1200, chunks)).toBe("1,200 chunks");
    expect(formatCount("tr", 1, { one: "chunk", other: "chunk" })).toBe("1 chunk");
    expect(formatCount("tr", 1200, { one: "soru", other: "soru" })).toBe("1.200 soru");
  });

  it("formats diagnostic scores with fixed precision and a visible empty value", () => {
    expect(formatScore(0.8)).toBe("0.80");
    expect(formatScore(1)).toBe("1.00");
    expect(formatScore(0.12345, 4)).toBe("0.1235");
    expect(formatScore(null)).toBe("—");
    expect(formatScore(undefined)).toBe("—");
  });

  it("formats durations in milliseconds below a second and seconds above", () => {
    expect(formatMs("en", 0)).toBe("0 ms");
    expect(formatMs("en", 845.6)).toBe("846 ms");
    expect(formatMs("en", 1250)).toBe("1.3 s");
    expect(formatMs("tr", 1250)).toBe("1,3 s");
    expect(formatMs("en", 12000)).toBe("12 s");
    expect(formatMs("en", null)).toBe("—");
    expect(formatMs("en", -5)).toBe("—");
  });
});
