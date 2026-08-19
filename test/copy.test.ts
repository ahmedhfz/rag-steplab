import { describe, expect, it } from "vitest";

import { UI_COPY } from "@/lib/copy";

describe("UI copy", () => {
  it("keeps pipeline titles and Turkish terminology intentionally localized", () => {
    expect(UI_COPY.en.overview.title).toBe("RAG Pipeline");
    expect(UI_COPY.tr.overview.title).toBe("RAG İşlem Hattı");
    expect(UI_COPY.tr.footer.localProject).toBe("Yerel öğrenme projesi");
    expect(UI_COPY.tr.evaluation.emptyNote).not.toContain("placeholder");
  });
});
