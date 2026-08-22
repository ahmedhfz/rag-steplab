import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrations = [
  ["app/documents/parsed/page.tsx", "/parse"],
  ["app/documents/chunks/page.tsx", "/chunking"],
  ["app/retrieval/page.tsx", "/playground"],
] as const;

describe("legacy route migration contract", () => {
  it.each(migrations)("keeps %s as a permanent redirect to %s", (file, target) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).toContain("permanentRedirect");
    expect(source).toContain(`permanentRedirect(\"${target}\")`);
  });
});
