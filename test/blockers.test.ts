import { describe, expect, it } from "vitest";

import { blocker, getPipelineAvailability } from "@/lib/blockers";

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

  it("never reports a lineage blocker while the workspace is still loading", () => {
    const loading = getPipelineAvailability("en", "retrieval", { document: null, workspaceStatus: "loading", persistenceStatus: "available" });
    expect(loading).toMatchObject({ allowed: false, code: "loading", href: null });
    expect(getPipelineAvailability("en", "chunk", { document: null, persistenceStatus: "checking" })).toMatchObject({ code: "loading" });
    expect(getPipelineAvailability("en", "chunk", { document: null, workspaceStatus: "ready", persistenceStatus: "available" })).toMatchObject({ code: "missing_document" });
    expect(getPipelineAvailability("en", "chunk", { document: { id: "document-1" }, workspaceStatus: "unavailable" })).toMatchObject({ code: "backend_unavailable" });
  });

  it("names the missing dataset name and links Playground blockers to the current route", () => {
    expect(blocker("en", "missing_dataset_name")).toEqual({ code: "missing_dataset_name", message: "Enter a dataset name." });
    expect(blocker("tr", "missing_dataset_name").message).toBe("Bir dataset adı girin.");
    expect(getPipelineAvailability("en", "retrieval", {
      document: { id: "document-1" },
      selection: { selectedParseRunId: "parse-1", selectedChunkRunId: "chunk-1", selectedEmbeddingRunId: null },
      parseRun: { id: "parse-1", status: "completed", isCompatible: true },
      chunkRun: completedRun,
      retrievalMode: "keyword",
      hasQuestion: false,
      persistenceStatus: "available",
    })).toMatchObject({ code: "missing_question", href: "/playground" });
  });
});
