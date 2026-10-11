import { describe, expect, it } from "vitest";

import { withLineageFlagsFrom, withSelectionLineageFlags } from "@/lib/lineage-flags";
import type { DocumentSummary } from "@/lib/rag-api-types";

const run = (id: string, extra: Record<string, unknown> = {}) => ({
  id, status: "completed", progress: null, isStale: false, isCompatible: true, compatibilityReason: null,
  historicalLineage: false, upstream: {}, config: {}, timing: {}, ...extra,
});

const detail = {
  id: "d", parseRuns: [run("p1"), run("p2")], chunkRuns: [run("c1"), run("c2"), run("c3", { status: "running" })],
  embeddingRuns: [run("e1")],
  experiments: [run("x1", { chunkRunId: "c1", embeddingRunId: null }), run("x2", { chunkRunId: "c1", embeddingRunId: "e-other" })],
  evaluationDatasets: [], evaluationRuns: [],
} as unknown as DocumentSummary;

describe("lineage flags", () => {
  it("marks completed runs outside the scratch selection as historical", () => {
    const flagged = withSelectionLineageFlags(detail, { selectedParseRunId: "p1", selectedChunkRunId: "c1", selectedEmbeddingRunId: "e1" });
    expect(flagged.parseRuns.map((item) => item.historicalLineage)).toEqual([false, true]);
    expect(flagged.chunkRuns.map((item) => item.historicalLineage)).toEqual([false, true, false]);
    expect(flagged.embeddingRuns[0].historicalLineage).toBe(false);
    expect(flagged.experiments.map((item) => item.historicalLineage)).toEqual([false, true]);
  });

  it("copies only historicalLineage flags from a refreshed summary", () => {
    const refreshed = { ...detail, chunkRuns: [run("c1", { historicalLineage: true, status: "failed" })] } as unknown as DocumentSummary;
    const merged = withLineageFlagsFrom(detail, refreshed);
    expect(merged.chunkRuns[0]).toMatchObject({ id: "c1", historicalLineage: true, status: "completed" });
    expect(merged.chunkRuns[1]).toBe(detail.chunkRuns[1]);
  });
});
