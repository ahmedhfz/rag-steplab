import { describe, expect, it } from "vitest";

import {
  chunkFormConfigFromRun,
  chunkStageState,
  describeReparseImpact,
  resolveLineageSelection,
} from "@/lib/pipeline-lineage";
import type { DocumentSummary, RunSummary } from "@/lib/rag-api-types";

function run(id: string, upstream: Record<string, string | null> = {}, overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id,
    status: "completed",
    progress: 100,
    isStale: false,
    isCompatible: true,
    compatibilityReason: null,
    historicalLineage: false,
    upstream,
    config: {},
    timing: { startedAt: null, completedAt: null, durationMs: null },
    error: null,
    ...overrides,
  };
}

function summary(): DocumentSummary {
  return {
    id: "document-1",
    fileName: "lesson.pdf",
    mediaType: "application/pdf",
    sizeBytes: 1,
    pageCount: 1,
    sha256: null,
    activeParseRunId: "parse-active",
    activeChunkRunId: "chunk-active",
    activeEmbeddingRunId: null,
    createdAt: null,
    updatedAt: null,
    parseRuns: [run("parse-active"), run("parse-old")],
    chunkRuns: [run("chunk-active", { parseRunId: "parse-active" }), run("chunk-old", { parseRunId: "parse-old" })],
    embeddingRuns: [],
    experiments: [],
    evaluationDatasets: [],
    evaluationRuns: [],
  };
}

describe("lineage resolution", () => {
  it("keeps a saved pipeline strict and lets the scratch workspace fall back to active runs", () => {
    const stored = { selectedParseRunId: "parse-missing", selectedChunkRunId: null, selectedEmbeddingRunId: null };
    expect(resolveLineageSelection(summary(), stored, true)).toEqual({ selectedParseRunId: null, selectedChunkRunId: null, selectedEmbeddingRunId: null });
    expect(resolveLineageSelection(summary(), stored, false)).toEqual({ selectedParseRunId: "parse-active", selectedChunkRunId: "chunk-active", selectedEmbeddingRunId: null });
  });

  it("never pairs a chunk run with a different parse run", () => {
    const stored = { selectedParseRunId: "parse-active", selectedChunkRunId: "chunk-old", selectedEmbeddingRunId: null };
    expect(resolveLineageSelection(summary(), stored, true).selectedChunkRunId).toBeNull();
  });
});

describe("reparse impact", () => {
  it("requires confirmation only when a downstream selection would be cleared", () => {
    const pipeline = { id: "pipeline-1", name: "Main" };
    expect(describeReparseImpact(pipeline, { selectedParseRunId: "p", selectedChunkRunId: "c", selectedEmbeddingRunId: "e" })).toEqual({
      target: "pipeline", pipelineId: "pipeline-1", pipelineName: "Main", clearsChunk: true, clearsEmbedding: true, requiresConfirmation: true,
    });
    expect(describeReparseImpact(null, { selectedParseRunId: "p", selectedChunkRunId: null, selectedEmbeddingRunId: null })).toMatchObject({
      target: "scratch", requiresConfirmation: false,
    });
  });
});

describe("chunk stage state", () => {
  const recursive = run("chunk-1", { parseRunId: "parse-1" }, { strategy: "recursive_token", config: { chunkSizeTokens: 256, overlapTokens: 32 } });

  it("starts the form from the selected run and falls back to defaults", () => {
    expect(chunkFormConfigFromRun(recursive)).toEqual({ strategy: "recursive_token", config: { chunkSizeTokens: 256, overlapTokens: 32 } });
    expect(chunkFormConfigFromRun(null)).toEqual({ strategy: "structure_aware", config: { chunkSizeTokens: 512, overlapTokens: 64 } });
  });

  it("is up to date only for an unchanged config of a compatible child of the selected parse", () => {
    const form = chunkFormConfigFromRun(recursive);
    expect(chunkStageState(recursive, "parse-1", form)).toEqual({ isDirty: false, isUpToDate: true });
    expect(chunkStageState(recursive, "parse-2", form)).toEqual({ isDirty: false, isUpToDate: false });
    expect(chunkStageState(recursive, "parse-1", { ...form, strategy: "fixed_token" })).toEqual({ isDirty: true, isUpToDate: false });
    expect(chunkStageState({ ...recursive, isCompatible: false }, "parse-1", form).isUpToDate).toBe(false);
    expect(chunkStageState(null, "parse-1", form)).toEqual({ isDirty: true, isUpToDate: false });
  });
});
