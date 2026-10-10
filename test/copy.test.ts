import { describe, expect, it } from "vitest";

import { interpolate, runName, UI_COPY } from "@/lib/copy";

describe("UI copy", () => {
  it("keeps pipeline titles and Turkish terminology intentionally localized", () => {
    expect(UI_COPY.en.overview.title).toBe("Build your RAG, one step at a time.");
    expect(UI_COPY.tr.overview.title).toBe("RAG'ınızı adım adım oluşturun.");
  });

  it("applies the Test/Measure glossary to Playground and Evaluation copy", () => {
    expect(UI_COPY.tr.retrieval.title).toBe("Deney Alanı");
    expect(UI_COPY.tr.retrieval.stages.generation).toBe("Cevap");
    expect(UI_COPY.tr.retrieval.stagesTitle).toBe("Aşamalar");
    expect(UI_COPY.tr.retrieval.history).toBe("Çalıştırma geçmişi");
    expect(UI_COPY.tr.retrieval.citations).toBe("Atıflar");
    expect(runName(UI_COPY.tr, "experiment", 1)).toBe("Deney #1");
    expect(runName(UI_COPY.tr, "evaluation", 2)).toBe("Değerlendirme #2");
    expect(runName(UI_COPY.en, "experiment", 1)).toBe("Experiment #1");
    // Page titles, run names and the bridge CTA share the sidebar names.
    expect(UI_COPY.tr.retrieval.title).toBe(UI_COPY.tr.nav.playground);
    expect(UI_COPY.tr.evaluation.title).toBe(UI_COPY.tr.nav.evaluation);
    expect(UI_COPY.tr.runs.names.evaluation).toBe(UI_COPY.tr.nav.evaluation);
    expect(UI_COPY.en.retrieval.title).toBe(UI_COPY.en.nav.playground);
    expect(UI_COPY.tr.evaluation.tabs).toEqual({ dataset: "Veri seti", results: "Sonuçlar", compare: "Karşılaştır" });
    expect(UI_COPY.tr.evaluation.judge).toBe("Değerlendirici model");
    expect(UI_COPY.tr.evaluation.metrics.faithfulness).toBe("Kaynağa sadakat");
    expect(UI_COPY.tr.evaluation.metrics.lexicalOverlap).toBe("Kaynak kelime örtüşmesi (tanısal)");
    // RAG terms stay English in Turkish; the citation caveat is one shared sentence.
    expect(UI_COPY.tr.retrieval.modes).toEqual({ dense: "Dense", hybrid: "Hybrid", keyword: "Keyword" });
    expect(UI_COPY.tr.retrieval.citationCaveat).toBe(UI_COPY.tr.evaluation.metricHints.citationValidity);
    expect(UI_COPY.en.retrieval.citationCaveat).toBe(UI_COPY.en.evaluation.metricHints.citationValidity);
  });

  it("uses one glossary name per stage across sidebar, journey and CTAs", () => {
    const tr = UI_COPY.tr;
    // RAG terms stay English in Turkish; everything else is Turkish.
    expect(tr.nav).toMatchObject({ parse: "Ayrıştırma", chunking: "Chunking", embeddings: "Embedding", playground: "Deney Alanı", evaluation: "Değerlendirme" });
    expect(tr.navGroups).toEqual({ prepare: "Hazırla", test: "Test et", measure: "Ölç" });
    expect(tr.overview.journey.steps).toMatchObject({ parse: tr.nav.parse, chunk: tr.nav.chunking, embed: tr.nav.embeddings, context: "Context", generate: "Cevap", evaluate: tr.nav.evaluation });
    expect(tr.overview.continuation.chunk).toBe("Chunking'e devam et");
    expect(tr.overview.continuation.playground).toBe("Deney Alanı'na devam et");
    expect(tr.overview.continuation.evaluation).toBe("Değerlendirmeye devam et");
    expect(tr.chunking.strategies).toEqual({ fixed_token: "Sabit token", recursive_token: "Özyinelemeli", structure_aware: "Yapıya duyarlı" });
    expect(UI_COPY.en.nav.parse).toBe(UI_COPY.en.overview.journey.steps.parse);
  });

  it("names runs and fills templates the same way everywhere", () => {
    expect(runName(UI_COPY.tr, "parse", 3)).toBe("Ayrıştırma #3");
    expect(runName(UI_COPY.en, "parse", 3)).toBe("Parse #3");
    expect(runName(UI_COPY.en, "chunk", 2)).toBe("Chunking #2");
    expect(runName(UI_COPY.tr, "embedding", null)).toBe("Embedding #—");
    expect(interpolate(UI_COPY.tr.runs.inspectionBand, { inspected: "Ayrıştırma #2", selected: "Ayrıştırma #3" }))
      .toBe("Ayrıştırma #2 inceleniyor; pipeline'da Ayrıştırma #3 kullanılıyor.");
    expect(interpolate("{a} and {missing}", { a: "x" })).toBe("x and {missing}");
  });

  it("keeps sentence case and no uppercase eyebrows in owned sections", () => {
    const owned = [UI_COPY.en.parse, UI_COPY.en.chunking, UI_COPY.en.embeddings, UI_COPY.tr.parse, UI_COPY.tr.chunking, UI_COPY.tr.embeddings];
    const strings = owned.flatMap((section) => JSON.stringify(section).match(/"[^"]{4,}"/g) ?? []);
    // Multi-word all-caps strings ("RESULT SUMMARY", "CHUNK COUNT") were eyebrows; acronyms like JSON are fine.
    expect(strings.filter((value) => /^"[A-ZÇĞİÖŞÜ.]{2,}( [A-ZÇĞİÖŞÜ.]+)+"$/.test(value))).toEqual([]);
  });
});
