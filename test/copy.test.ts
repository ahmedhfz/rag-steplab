import { describe, expect, it } from "vitest";

import { UI_COPY } from "@/lib/copy";

describe("UI copy", () => {
  it("keeps pipeline titles and Turkish terminology intentionally localized", () => {
    expect(UI_COPY.en.overview.title).toBe("Build your RAG, one step at a time.");
    expect(UI_COPY.tr.overview.title).toBe("RAG'ınızı adım adım oluşturun.");
    expect(UI_COPY.tr.footer.localProject).toBe("RAG öğrenme laboratuvarı");
    expect(UI_COPY.tr.evaluation.emptyNote).not.toContain("placeholder");
  });
});
