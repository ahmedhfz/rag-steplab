import { describe, expect, it } from "vitest";

import { getPipelineAvailability } from "@/lib/blockers";

const completedRun = {
  id: "chunk-1",
  status: "completed" as const,
  isCompatible: true,
  upstream: { parseRunId: "parse-1", chunkRunId: "chunk-1" },
};

describe("pipeline availability contract", () => {
  it("returns a stable allowed result for a complete dense retrieval prerequisite set", () => {
    const input = {
      document: { id: "document-1" },
      selection: { selectedParseRunId: "parse-1", selectedChunkRunId: "chunk-1", selectedEmbeddingRunId: "embedding-1" },
      parseRun: { ...completedRun, id: "parse-1" },
      chunkRun: completedRun,
      embeddingRun: { ...completedRun, id: "embedding-1", upstream: { chunkRunId: "chunk-1" } },
      hasQuestion: true,
      persistenceStatus: "available" as const,
      retrievalMode: "dense" as const,
    };

    expect(getPipelineAvailability("tr", "retrieval", input)).toEqual({
      allowed: true,
      code: null,
      message: "",
      requiredAction: null,
      href: null,
    });
  });

  it("resolves deterministic localized blockers in prerequisite order", () => {
    expect(getPipelineAvailability("tr", "embedding", {
      document: null,
      persistenceStatus: "available",
    })).toMatchObject({ allowed: false, code: "missing_document", href: "/documents" });

    expect(getPipelineAvailability("en", "embedding", {
      document: { id: "document-1" },
      selection: { selectedParseRunId: "parse-1" },
      parseRun: { id: "parse-1", status: "completed", isCompatible: true },
      persistenceStatus: "available",
    })).toMatchObject({ allowed: false, code: "missing_chunk", href: "/chunking" });
  });

  it("rejects an upstream mismatch and allows keyword retrieval without embeddings", () => {
    const mismatch = getPipelineAvailability("en", "embedding", {
      document: { id: "document-1" },
      selection: { selectedParseRunId: "parse-1", selectedChunkRunId: "chunk-2" },
      parseRun: { id: "parse-1", status: "completed", isCompatible: true },
      chunkRun: completedRun,
      persistenceStatus: "available",
    });
    expect(mismatch).toMatchObject({ allowed: false, code: "incompatible_lineage" });

    const keyword = getPipelineAvailability("en", "retrieval", {
      document: { id: "document-1" },
      selection: { selectedParseRunId: "parse-1", selectedChunkRunId: "chunk-1", selectedEmbeddingRunId: null },
      parseRun: { id: "parse-1", status: "completed", isCompatible: true },
      chunkRun: completedRun,
      hasQuestion: true,
      persistenceStatus: "available",
      retrievalMode: "keyword",
    });
    expect(keyword.allowed).toBe(true);
  });
});
