import { describe, expect, it } from "vitest";

import { upsertUploadedDocument, withSummaryProjection } from "@/lib/document-list";
import type { DocumentSummary, PersistedDocument, RunSummary } from "@/lib/rag-api-types";

const sample: PersistedDocument = {
  id: "sample", fileName: "rag-steplab-sample-city-bikes.pdf", mediaType: "application/pdf", sizeBytes: 100, pageCount: 4, sha256: "sha",
  activeParseRunId: "parse-1", activeChunkRunId: null, activeEmbeddingRunId: null, latestParseStatus: "completed", latestParseError: null, createdAt: null, updatedAt: null,
};
const other: PersistedDocument = { ...sample, id: "other", fileName: "other.pdf", sha256: "other" };

function run(id: string, status: RunSummary["status"], error: RunSummary["error"] = null): RunSummary {
  return { id, status, progress: null, isStale: false, isCompatible: true, compatibilityReason: null, historicalLineage: false, upstream: {}, config: {}, timing: { startedAt: null, completedAt: null, durationMs: null }, error };
}

function summary(document: PersistedDocument, parseRuns: RunSummary[]): DocumentSummary {
  return { ...document, latestParseStatus: null, latestParseError: null, parseRuns, chunkRuns: [], embeddingRuns: [], experiments: [], evaluationDatasets: [], evaluationRuns: [] };
}

describe("document library rows", () => {
  it("keeps a re-uploaded PDF's parse state: the upload response carries none", () => {
    // POST /documents returns the bare document row for a reused upload.
    const uploaded = { ...sample, latestParseStatus: null, latestParseError: null };
    const rows = upsertUploadedDocument([other, sample], uploaded, true);
    expect(rows.map((row) => row.id)).toEqual(["sample", "other"]);
    expect(rows[0]).toMatchObject({ pageCount: 4, latestParseStatus: "completed" });
  });

  it("adds a new upload as not parsed", () => {
    const uploaded = { ...other, id: "new", pageCount: 0, latestParseStatus: null };
    const rows = upsertUploadedDocument([sample], uploaded, false);
    expect(rows[0]).toMatchObject({ id: "new", latestParseStatus: null });
    expect(rows).toHaveLength(2);
  });

  it("follows the newest parse run of a loaded summary", () => {
    const fresh = { ...other, latestParseStatus: null, pageCount: 0, activeParseRunId: null };
    const failure = { code: "docling_error", message: "Docling could not parse this PDF." };
    const parsed = withSummaryProjection([sample, fresh], summary({ ...fresh, pageCount: 2, activeParseRunId: "parse-9" }, [run("parse-9", "completed")]));
    expect(parsed[1]).toMatchObject({ pageCount: 2, activeParseRunId: "parse-9", latestParseStatus: "completed" });
    const failed = withSummaryProjection(parsed, summary({ ...fresh, pageCount: 2 }, [run("parse-10", "failed", failure), run("parse-9", "completed")]));
    expect(failed[1]).toMatchObject({ latestParseStatus: "failed", latestParseError: failure });
    expect(failed[0]).toBe(sample);
  });

  it("returns the same list when the summary changes nothing or the document is not listed", () => {
    const rows = [sample];
    expect(withSummaryProjection(rows, summary(sample, [run("parse-1", "completed")]))).toBe(rows);
    expect(withSummaryProjection(rows, summary(other, []))).toBe(rows);
  });
});
