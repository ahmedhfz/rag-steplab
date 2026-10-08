import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SAMPLE_DOCUMENTS, sampleForHash } from "@/lib/sample-documents";

describe("bundled sample PDFs", () => {
  it.each(Object.entries(SAMPLE_DOCUMENTS))("keeps the %s question set tied to the shipped PDF", (_locale, sample) => {
    const bytes = readFileSync(join(process.cwd(), "public", sample.path));
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(bytes.byteLength).toBeLessThan(100_000);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sample.sha256);
    expect(sampleForHash(sample.sha256)?.questions).toEqual(sample.questions);
    expect(sampleForHash(sample.sha256.toUpperCase())?.questions).toEqual(sample.questions);
  });

  it("never offers sample questions for an unrelated document", () => {
    expect(sampleForHash("different-hash")).toBeNull();
    expect(sampleForHash(null)).toBeNull();
  });
});
